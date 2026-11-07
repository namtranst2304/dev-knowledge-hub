'use server'

import { create, update, deleteEntity, getAll, getById } from '@/lib/actions/base-crud'
import { Project } from '@/features/working/types'
import { slugify } from '../utils/slug'

const CONFIG = {
    tableName: 'projects',
    revalidatePaths: ['/working']
}

export async function getProjects() {
    const { data } = await getAll<Project>(CONFIG)
    return data
}

export async function getProjectById(idOrSlug: string) {
    if (!idOrSlug) return null

    let target = idOrSlug.trim()
    try {
        target = decodeURIComponent(target)
    } catch {
        // use raw target if URI is malformed
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)
    if (isUUID) {
        const project = await getById<Project>(CONFIG, target)
        if (project) return project
    }

    // If not a UUID or UUID lookup didn't match, search user's projects by slug, name or id
    const { data: projects } = await getAll<Project>(CONFIG)
    if (!projects || projects.length === 0) return null

    const lowerTarget = target.toLowerCase()
    const rawLower = idOrSlug.toLowerCase().trim()
    const slugifiedTarget = slugify(target)
    const slugifiedRaw = slugify(idOrSlug)

    // 1. Check explicit slug column
    const bySlug = projects.find(p => p.slug && (
        p.slug.toLowerCase() === lowerTarget || 
        p.slug.toLowerCase() === rawLower ||
        p.slug.toLowerCase() === slugifiedTarget ||
        p.slug.toLowerCase() === slugifiedRaw
    ))
    if (bySlug) return bySlug

    // 2. Check generated slug from name
    const bySlugifiedName = projects.find(p => {
        const s = slugify(p.name)
        return s === lowerTarget || s === rawLower || s === slugifiedTarget || s === slugifiedRaw
    })
    if (bySlugifiedName) return bySlugifiedName

    // 3. Check exact name (case-insensitive)
    const byName = projects.find(p => p.name.toLowerCase() === lowerTarget || p.name.toLowerCase() === rawLower)
    if (byName) return byName

    // 4. Fallback check by id
    return projects.find(p => p.id === target || p.id === idOrSlug.trim()) || null
}

export async function createProject(input: Record<string, unknown>): Promise<Project | { error: string }> {
    const payload = { ...input }
    if (payload.name) {
        if (!payload.slug) payload.slug = slugify(String(payload.name));
        if (!payload.title) payload.title = payload.name;
    } else if (payload.title && !payload.name) {
        payload.name = payload.title;
        if (!payload.slug) payload.slug = slugify(String(payload.title));
    }

    try {
        return await create<Project>(CONFIG, payload)
    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        
        // 1. If DB lacks 'slug' column
        if (errorMsg.includes('slug')) {
            const { slug: _s, ...noSlug } = payload
            try {
                return await create<Project>(CONFIG, noSlug)
            } catch {
                // fall through
            }
        }

        // 2. If DB lacks 'title' column (clean schema)
        if (errorMsg.includes('title')) {
            const { title: _t, ...noTitle } = payload
            try {
                return await create<Project>(CONFIG, noTitle)
            } catch {
                // fall through
            }
        }

        // 3. If DB lacks 'name' column (legacy schema)
        if (errorMsg.includes('name')) {
            const { name: _n, ...noName } = payload
            try {
                const created = await create<Project>(CONFIG, noName)
                return { ...created, name: payload.name as string } as Project
            } catch {
                // fall through
            }
        }

        console.error('createProject error:', errorMsg)
        return { error: 'Đã xảy ra lỗi hệ thống.' }
    }
}

export async function updateProject(id: string, input: Record<string, unknown>): Promise<Project | { error: string }> {
    const payload = { ...input }
    if (payload.name) {
        if (!payload.slug) payload.slug = slugify(String(payload.name));
        if (!payload.title) payload.title = payload.name;
    } else if (payload.title && !payload.name) {
        payload.name = payload.title;
        if (!payload.slug) payload.slug = slugify(String(payload.title));
    }

    try {
        return await update<Project>(CONFIG, id, payload)
    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        
        // 1. If DB lacks 'slug' column
        if (errorMsg.includes('slug')) {
            const { slug: _s, ...noSlug } = payload
            try {
                return await update<Project>(CONFIG, id, noSlug)
            } catch {
                // fall through
            }
        }

        // 2. If DB lacks 'title' column
        if (errorMsg.includes('title')) {
            const { title: _t, ...noTitle } = payload
            try {
                return await update<Project>(CONFIG, id, noTitle)
            } catch {
                // fall through
            }
        }

        console.error('updateProject error:', errorMsg)
        return { error: 'Đã xảy ra lỗi hệ thống.' }
    }
}

export async function deleteProject(id: string) {
    return await deleteEntity<Project>(CONFIG, id)
}
