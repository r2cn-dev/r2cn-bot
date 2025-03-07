
import { User } from "@octokit/webhooks-types";
import { CommandRequest, Config, postData } from "./common.js";
import { Task, TaskStatus } from "./task.js";
import { Context } from "probot";
import { Payload } from "./mentor.js";

export async function handle_stu_cmd(context: Context, config: Config, payload: Payload) {
    var command_res = {
        result: false,
        message: "",
    };
    const { user, command, task } = payload;

    const setResponse = (message: string, result: boolean = false) => {
        command_res.message = message;
        command_res.result = result;
        return command_res;
    };

    const isStudentAuthorized = (task: Task, student: User) => {
        return task.student_github_login === student.login;
    };

    const req = {
        github_issue_id: task.github_issue_id,
        student_login: user.login,
    };

    switch (command) {
        case "/request-assign":
            if (task.task_status == TaskStatus.RequestAssign) {
                return setResponse(config.comment.requestAssign.claimByOther);
            }

            if (task.task_status !== TaskStatus.Open) {
                return setResponse(config.comment.command.invalidTaskState);
            }

            // 学生身份校验
            const verify = await verifyStudentIdentity(user.login);
            if (!verify.success) {
                return setResponse(config.comment.requestAssign.waitingInfoReview);
            }

            // 合同签署校验
            // if (!verify.contract_deadline) {
            //     return setResponse(config.comment.requestAssign.waitingContract);
            // }

            if (task.student_github_login === user.login) {
                return setResponse(config.comment.requestAssign.alreadyClaim);
            }

            if (!await verifyStudentTask(user.login)) {
                return setResponse(config.comment.requestAssign.existTask);
            }

            if (await requestAssign({
                github_issue_id: task.github_issue_id,
                student_login: user.login,
            })) {
                return setResponse(config.comment.requestAssign.success, true);
            } else {
                return setResponse("API ERROR");
            }
        case "/request-complete":
            if (task.task_status !== TaskStatus.Assigned) {
                return setResponse(config.comment.command.invalidTaskState);
            }

            if (!isStudentAuthorized(task, user)) {
                return setResponse(config.comment.command.noPermission);
            }

            //check related PRs
            // const res = await context.octokit.issues.get({
            //     owner: task.owner,
            //     repo: task.repo,
            //     issue_number: task.github_issue_number
            // });

            // if (res.data.pull_request == undefined) {
            //     return setResponse(config.requestComplete.noRelatedPR);
            // }
            await requestComplete(req)
            return setResponse(config.comment.requestComplete.success, true);

        case "/request-release":
            if (task.task_status !== TaskStatus.Assigned) {
                return setResponse(config.comment.command.invalidTaskState);
            }

            if (!isStudentAuthorized(task, user)) {
                return setResponse(config.comment.command.noPermission);
            }

            await releaseTask(req, context, payload)
            return setResponse(config.comment.requestRelease.success, true);

        default:
            return setResponse(config.comment.command.unsupportStuCommand);
    }
}


interface UserReq {
    login: string
}

interface VerifyStuRes {
    success: true,
    student_name?: string
    contract_deadline?: string,
}

async function verifyStudentIdentity(login: string) {
    const apiUrl = `${process.env.API_ENDPOINT}/student/validate`;
    const res = await postData<VerifyStuRes, UserReq>(apiUrl, {
        "login": login
    }).then((res) => {
        return res.data
    });
    return res
}

async function verifyStudentTask(login: string) {
    const apiUrl = `${process.env.API_ENDPOINT}/student/task`;
    const res = await postData<Task, UserReq>(apiUrl, {
        "login": login
    }).then((res) => {
        return res.data
    });
    return res === null
}



async function requestAssign(req: CommandRequest) {
    const apiUrl = `${process.env.API_ENDPOINT}/task/request-assign`;
    const res = await postData<boolean, CommandRequest>(apiUrl, req).then((res) => {
        return res.data
    });
    return res
}

export async function releaseTask(req: CommandRequest, context: Context, payload: Payload) {
    const { task, issue } = payload;
    const existingLabels = issue.labels?.some(label => label.name === "已认领");
    if (existingLabels) {
        await context.octokit.issues.removeLabel({
            owner: task.owner,
            repo: task.repo,
            issue_number: task.github_issue_number,
            name: "已认领",
        });
    }
    if (task.student_github_login) { 
        await context.octokit.issues.removeAssignees({
            owner: task.owner,
            repo: task.repo,
            issue_number: task.github_issue_number,
            assignees: [task.student_github_login],
        });
    }
    const apiUrl = `${process.env.API_ENDPOINT}/task/release`;
    const res = await postData<boolean, CommandRequest>(apiUrl, req).then((res) => {
        return res.data
    });
    return res
}

async function requestComplete(req: CommandRequest) {
    const apiUrl = `${process.env.API_ENDPOINT}/task/request-complete`;
    const res = await postData<boolean, CommandRequest>(apiUrl, req).then((res) => {
        return res.data
    });
    return res
}