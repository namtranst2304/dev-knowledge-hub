'use server'

import { create, update, deleteEntity, getAll, getById } from '@/lib/actions/base-crud'
import { Task } from '@/features/working/types'

const CONFIG = {
    tableName: 'tasks'
}

export async function getTasks(projectId?: string) {
    const filters: Record<string, unknown> = {}
    if (projectId) {
        filters.project_id = projectId
    }

    const { data } = await getAll<Task>(CONFIG, { filters })
    return data
}

export async function getTaskById(id: string) {
    return await getById<Task>(CONFIG, id)
}

export async function createTask(input: Record<string, unknown>): Promise<Task | { error: string }> {
    try {
        return await create<Task>(CONFIG, input)
    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        // If columns issue_type, story_points or subtasks do not exist in DB yet, fallback to core fields
        if (errorMsg.includes('column') || errorMsg.includes('schema') || errorMsg.includes('does not exist')) {
            const { issue_type: _it, story_points: _sp, subtasks: _st, issue_key: _ik, ...coreInput } = input
            try {
                const fallbackResult = await create<Task>(CONFIG, coreInput)
                return {
                    ...fallbackResult,
                    issue_type: input.issue_type as Task['issue_type'],
                    story_points: input.story_points as Task['story_points'],
                    subtasks: input.subtasks as Task['subtasks'],
                    issue_key: input.issue_key as Task['issue_key'],
                } as Task
            } catch (innerErr: unknown) {
                const innerMsg = innerErr instanceof Error ? innerErr.message : String(innerErr)
                console.error('createTask fallback error:', innerMsg)
                return { error: 'Đã xảy ra lỗi hệ thống khi tạo.' }
            }
        }
        console.error('createTask error:', errorMsg)
        return { error: 'Đã xảy ra lỗi hệ thống khi tạo.' }
    }
}

export async function updateTask(id: string, input: Record<string, unknown>): Promise<Task | { error: string }> {
    try {
        return await update<Task>(CONFIG, id, input)
    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        // If columns issue_type, story_points or subtasks do not exist in DB yet, fallback to core fields
        if (errorMsg.includes('column') || errorMsg.includes('schema') || errorMsg.includes('does not exist')) {
            const { issue_type: _it, story_points: _sp, subtasks: _st, issue_key: _ik, ...coreInput } = input
            try {
                const fallbackResult = await update<Task>(CONFIG, id, coreInput)
                return {
                    ...fallbackResult,
                    issue_type: input.issue_type as Task['issue_type'],
                    story_points: input.story_points as Task['story_points'],
                    subtasks: input.subtasks as Task['subtasks'],
                    issue_key: input.issue_key as Task['issue_key'],
                } as Task
            } catch (innerErr: unknown) {
                const innerMsg = innerErr instanceof Error ? innerErr.message : String(innerErr)
                console.error('updateTask fallback error:', innerMsg)
                return { error: 'Đã xảy ra lỗi hệ thống khi cập nhật.' }
            }
        }
        console.error('updateTask error:', errorMsg)
        return { error: 'Đã xảy ra lỗi hệ thống khi cập nhật.' }
    }
}

export async function deleteTask(id: string) {
    return await deleteEntity<Task>(CONFIG, id)
}
