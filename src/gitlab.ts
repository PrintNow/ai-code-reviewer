import axios, {AxiosInstance} from 'axios';
import {compareVersions} from "./utils";


export interface IGitLabConfig {
    gitlabApiUrl: string;
    gitlabAccessToken: string;
    projectId: string;
    mergeRequestId: string;
}

interface IMergeRequestInfo {
    source_branch: string;
    diff_refs: {
        base_sha: string;
        head_sha: string;
        start_sha: string;
    }
}

const parseLastDiff = (gitDiff: string) => {
    const diffList = gitDiff.split('\n').reverse();
    const lastLineFirstChar = diffList?.[1]?.[0];
    const lastDiff =
        diffList.find((item) => {
            return /^@@ \-\d+,\d+ \+\d+,\d+ @@/g.test(item);
        }) || '';

    const [lastOldLineCount, lastNewLineCount] = lastDiff
        .replace(/@@ \-(\d+),(\d+) \+(\d+),(\d+) @@.*/g, ($0, $1, $2, $3, $4) => {
            return `${+$1 + +$2},${+$3 + +$4}`;
        })
        .split(',');

    if (!/^\d+$/.test(lastOldLineCount) || !/^\d+$/.test(lastNewLineCount)) {
        return {
            old_line: -1,
            new_line: -1,
        };
    }

    const old_line = lastLineFirstChar === '+' ? -1 : (parseInt(lastOldLineCount) || 0) - 1;
    const new_line = lastLineFirstChar === '-' ? -1 : (parseInt(lastNewLineCount) || 0) - 1;

    return {
        old_line,
        new_line,
    };
};

export class GitLab {
    private gitlabVersion: string = 'latest';
    private apiClient: AxiosInstance;
    private projectId: string;
    private mrId: string;
    private diffRefs: {};
    private mergeRequestInfo?: IMergeRequestInfo;

    constructor({gitlabApiUrl, gitlabAccessToken, projectId, mergeRequestId}: IGitLabConfig) {
        this.projectId = projectId;
        this.mrId = mergeRequestId;
        this.diffRefs = {};
        this.apiClient = axios.create({
            baseURL: gitlabApiUrl,
            headers: {
                'Private-Token': gitlabAccessToken,
            },
        });
    }

    async init() {
        this.gitlabVersion = await this.getGitLabVersion();
        await this.getMergeRequestInfo();
    }

    async getGitLabVersion() {
        const response = await this.apiClient.get('/version');
        return response?.data?.version || 'latest';
    }

    async getMergeRequestInfo() {
        const response = await this.apiClient.get(`/projects/${this.projectId}/merge_requests/${this.mrId}`);
        this.mergeRequestInfo = response?.data;
    }

    async getMergeRequestChanges() {
        let resource_name = 'changes'
        if (compareVersions(this.gitlabVersion, '15.7') >= 0) {
            resource_name = 'diffs'
        }
        
        const response = await this.apiClient.get(`/projects/${this.projectId}/merge_requests/${this.mrId}/${resource_name}`);

        const data = resource_name === 'diffs'
            ? response.data
            : response.data.changes;

        const changes = data?.map((item: Record<string, any>) => {
            const {old_line, new_line} = parseLastDiff(item.diff);
            return {...item, old_line, new_line};
        });

        return changes;
    }

    async getFileContent(filePath: string) {
        const response = await this.apiClient.get(`/projects/${this.projectId}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${this.mergeRequestInfo?.source_branch}`);
        return response?.data || '';
    }

    async addReviewComment(lineObj: object, change: Record<string, any>, suggestion: string) {

        const response = await this.apiClient.post(`/projects/${this.projectId}/merge_requests/${this.mrId}/discussions`, {
            body: suggestion,
            position: {
                position_type: 'text',
                ...lineObj,
                new_path: change.new_path,
                old_path: change.old_path,
                ...this.mergeRequestInfo?.diff_refs,
            },
        });
        return response.data;
    }
}
