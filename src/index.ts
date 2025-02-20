import {Command} from 'commander';
import {GitLab} from './gitlab';
import {OpenAI} from './openai';
import {delay, getDiffBlocks, getLineObj} from "./utils";

const program = new Command();

program
    .option('-g, --gitlab-api-url <string>', 'GitLab API URL', ' https://gitlab.com/api/v4')
    .option('-t, --gitlab-access-token <string>', 'GitLab Access Token')
    .option('-o, --openai-api-url <string>', 'OpenAI API URL', 'https://api.openai.com/v1')
    .option('-mn, --openai-model-name <string>', 'OpenAI Model name', 'gpt-3.5-turbo')
    .option('-a, --openai-access-token <string>', 'OpenAI Access Token')
    .option('-p, --project-id <number>', 'GitLab Project ID')
    .option('-m, --merge-request-id <string>', 'GitLab Merge Request ID')
    .option('-org, --organization-id <number>', 'organization ID')
    .parse(process.argv);

async function run() {
    const {
        gitlabApiUrl,
        gitlabAccessToken,
        openaiApiUrl,
        openaiAccessToken,
        openaiModelName,
        projectId,
        mergeRequestId,
        organizationId
    } = program.opts();
    console.log('ai code review is underway...')
    const gitlab = new GitLab({gitlabApiUrl, gitlabAccessToken, projectId, mergeRequestId});
    const openai = new OpenAI(openaiApiUrl, openaiAccessToken, openaiModelName, organizationId);
    await gitlab.init().catch(() => {
        console.log('gitlab init error')
    });

    console.log(`>>> GitLab Version: ${gitlab.gitlabVersion}`)

    console.log(`>>> 开始获取[变更]文件内容...`)
    const changes = await gitlab.getMergeRequestChanges().catch(() => {
        console.log('get merge request changes error')
    });
    console.log(`<<< 完成获取[变更]文件内容...`)

    console.log(`>>> 开始 AI Code Review...`)
    let i = 0;
    for (const change of changes) {
        if (change.renamed_file || change.deleted_file || !change?.diff?.startsWith('@@')) {
            continue;
        }
        console.log(`>>> 正在处理第 ${++i} 个文件`)
        const diffBlocks = getDiffBlocks(change?.diff);
        while (!!diffBlocks.length) {
            const item = diffBlocks.shift()!;
            const lineRegex = /@@\s-(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/;
            const matches = lineRegex.exec(item);
            if (matches) {
                const lineObj = getLineObj(matches, item);
                if ((lineObj?.new_line && lineObj?.new_line > 0) || (lineObj.old_line && lineObj.old_line > 0)) {
                    try {
                        const suggestion = await openai.reviewCodeChange(item);
                        if (!suggestion.includes('666')) {
                            await gitlab.addReviewComment(lineObj, change, suggestion);
                        }
                    } catch (e: any) {
                        if (e?.response?.status === 429) {
                            console.log('Too Many Requests, try again');
                            await delay(60 * 1000);
                            diffBlocks.push(item);
                        }
                    }
                }
            }
        }
    }
    console.log('done');
}

module.exports = run;

