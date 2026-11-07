'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { extractCleanVideoId, getYoutubeThumbnail } from '@/features/media/utils';
import { resilientFetch } from '@/lib/resilience/resilient-fetch';

export async function getVideos() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return [];
    }

    // Query videos belonging to this user
    const query = supabase
        .from('youtube_videos')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching videos:', error);
        return [];
    }

    return data || [];
}

export async function addVideo(formData: FormData) {
    const url = formData.get('url') as string;
    if (!url) return;

    const videoId = extractCleanVideoId(url);
    if (!videoId) {
        throw new Error('Invalid YouTube URL');
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        throw new Error('User authentication required');
    }

    const thumbnailUrl = getYoutubeThumbnail(videoId);

    let title = `Video ${videoId}`;
    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const oembedRes = await resilientFetch<{ title?: string }>(oembedUrl, {
            timeoutMs: 3000,
            maxBytes: 64 * 1024,
            retries: 0
        });
        if (oembedRes.ok && oembedRes.data?.title) {
            title = oembedRes.data.title;
        }
    } catch (e) {
        console.error('Error fetching oembed:', e);
    }

    const insertPayload: Record<string, unknown> = {
        url,
        title,
        thumbnail_url: thumbnailUrl,
        saved_time: 0,
        user_id: user.id
    };

    const { error } = await supabase
        .from('youtube_videos')
        .insert(insertPayload);

    if (error) {
        console.error('Error adding video:', error);
        throw new Error('Failed to add video');
    }

    revalidatePath('/media/youtube');
}

export async function deleteVideo(id: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User authentication required');

    let deleteQuery = supabase
        .from('youtube_videos')
        .delete()
        .eq('id', id);

    deleteQuery = deleteQuery.eq('user_id', user.id);

    const { error } = await deleteQuery;

    if (error) {
        console.error('Error deleting video:', error);
        throw new Error('Failed to delete video');
    }

    revalidatePath('/media/youtube');
}

export async function updateVideoProgress(id: string, time: number) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let updateQuery = supabase
        .from('youtube_videos')
        .update({
            saved_time: time,
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    updateQuery = updateQuery.eq('user_id', user.id);

    const { error } = await updateQuery;

    if (error) {
        console.error('Error updating video progress:', error);
    }
}

export async function toggleFavorite(id: string, isFavorite: boolean) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let updateQuery = supabase
        .from('youtube_videos')
        .update({
            is_favorite: isFavorite,
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    updateQuery = updateQuery.eq('user_id', user.id);

    const { error } = await updateQuery;

    if (error) {
        console.error('Error toggling video favorite:', error);
    }

    revalidatePath('/media/youtube');
}

// --- Playlist Actions ---

export async function getPlaylists() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return [];

    const query = supabase
        .from('youtube_playlists')
        .select(`
            *,
            video_count:youtube_playlist_items(count),
            playlist_items:youtube_playlist_items(
                video:youtube_videos(thumbnail_url)
            )
        `)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching playlists:', error);
        return [];
    }

    return (data || []).map(p => {
        const thumbnails = (p.playlist_items || [])
            .map((item: { video: { thumbnail_url: string } | null }) => item.video?.thumbnail_url)
            .filter(Boolean)
            .slice(0, 4);

        return {
            ...p,
            video_count: p.video_count?.[0]?.count || 0,
            video_thumbnails: thumbnails
        };
    });
}

export async function createPlaylist(formData: FormData) {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;

    if (!title) throw new Error('Title is required');

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User authentication required');

    const insertPayload: Record<string, unknown> = {
        title,
        description,
        user_id: user.id
    };

    const { error } = await supabase
        .from('youtube_playlists')
        .insert(insertPayload);

    if (error) {
        console.error('Error creating playlist:', error);
        throw new Error('Failed to create playlist');
    }

    revalidatePath('/media/youtube');
}

export async function deletePlaylist(id: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User authentication required');

    let deleteQuery = supabase
        .from('youtube_playlists')
        .delete()
        .eq('id', id);

    deleteQuery = deleteQuery.eq('user_id', user.id);

    const { error } = await deleteQuery;

    if (error) {
        console.error('Error deleting playlist:', error);
        throw new Error('Failed to delete playlist');
    }

    revalidatePath('/media/youtube');
}

export async function updatePlaylist(id: string, formData: FormData) {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;

    if (!title) throw new Error('Title is required');

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User authentication required');

    let updateQuery = supabase
        .from('youtube_playlists')
        .update({
            title,
            description,
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    updateQuery = updateQuery.eq('user_id', user.id);

    const { error } = await updateQuery;

    if (error) {
        console.error('Error updating playlist:', error);
        throw new Error('Failed to update playlist');
    }

    revalidatePath('/media/youtube');
    revalidatePath(`/media/youtube/playlist/${id}`);
}

export async function addVideoToPlaylist(videoId: string, playlistId: string) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User authentication required');

    const [{ data: video, error: videoError }, { data: playlist, error: playlistError }] = await Promise.all([
        supabase
            .from('youtube_videos')
            .select('thumbnail_url')
            .eq('id', videoId)
            .eq('user_id', user.id)
            .single(),
        supabase
            .from('youtube_playlists')
            .select('id')
            .eq('id', playlistId)
            .eq('user_id', user.id)
            .single()
    ]);

    if (videoError || playlistError || !video || !playlist) {
        throw new Error('Video or playlist not found');
    }

    const { error } = await supabase
        .from('youtube_playlist_items')
        .insert({
            video_id: videoId,
            playlist_id: playlistId
        });

    if (error) {
        if (error.code === '23505') return;
        console.error('Error adding video to playlist:', error);
        throw new Error('Failed to add video to playlist');
    }

    if (video?.thumbnail_url) {
        await supabase
            .from('youtube_playlists')
            .update({
                thumbnail_url: video.thumbnail_url,
                updated_at: new Date().toISOString()
            })
            .eq('id', playlistId)
            .eq('user_id', user.id)
            .is('thumbnail_url', null);
    }

    revalidatePath('/media/youtube');
}

export async function removeVideoFromPlaylist(videoId: string, playlistId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User authentication required');

    const { data: playlist, error: playlistError } = await supabase
        .from('youtube_playlists')
        .select('id')
        .eq('id', playlistId)
        .eq('user_id', user.id)
        .single();

    if (playlistError || !playlist) throw new Error('Playlist not found');

    const { error } = await supabase
        .from('youtube_playlist_items')
        .delete()
        .eq('video_id', videoId)
        .eq('playlist_id', playlistId);

    if (error) {
        console.error('Error removing video from playlist:', error);
        throw new Error('Failed to remove video from playlist');
    }

    revalidatePath('/media/youtube');
}

export async function getPlaylistDetails(playlistId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: playlist, error: pError } = await supabase
        .from('youtube_playlists')
        .select('*')
        .eq('id', playlistId)
        .eq('user_id', user.id)
        .single();

    if (pError || !playlist) return null;

    const { data: items, error: iError } = await supabase
        .from('youtube_playlist_items')
        .select(`
            *,
            video:youtube_videos(*)
        `)
        .eq('playlist_id', playlistId)
        .order('position', { ascending: true });

    if (iError) {
        console.error('Error fetching playlist items:', iError);
        return { playlist, videos: [] };
    }

    return {
        playlist,
        videos: (items || []).map(item => item.video).filter(Boolean)
    };
}

export async function togglePlaylistFavorite(id: string, isFavorite: boolean) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let updateQuery = supabase
        .from('youtube_playlists')
        .update({
            is_favorite: isFavorite,
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    updateQuery = updateQuery.eq('user_id', user.id);

    const { error } = await updateQuery;

    if (error) {
        console.error('Error toggling playlist favorite:', error);
    }

    revalidatePath('/media/youtube');
}

interface RawYouTubePlaylistItem {
    id?: string;
    'yt:videoId'?: string;
    title?: string;
    author?: { name?: string };
    'media:group'?: {
        'media:title'?: string;
        'media:thumbnail'?: { '@_url'?: string };
        'media:description'?: string;
    };
}

interface ParsedYouTubePlaylistFeed {
    feed?: {
        title?: string;
        author?: { name?: string };
        entry?: RawYouTubePlaylistItem | RawYouTubePlaylistItem[];
    };
}

export async function importYouTubePlaylist(urlOrId: string): Promise<{ success: boolean; playlistId?: string; videoCount?: number; message?: string }> {
    const { extractCleanPlaylistId } = await import('../utils/youtube');
    const { XMLParser } = await import('fast-xml-parser');

    const playlistId = extractCleanPlaylistId(urlOrId);
    if (!playlistId) {
        return { success: false, message: 'Invalid YouTube playlist URL or ID. Make sure it contains "list=PL..."' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, message: 'User not authenticated' };
    }

    try {
        const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
        const fetchRes = await resilientFetch<string>(feedUrl, {
            timeoutMs: 4000,
            maxBytes: 500 * 1024,
            responseType: 'text',
            retries: 0,
            headers: {
                'User-Agent': 'DevKnowledgeHub-Media-Bot/1.0',
                'Accept': 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
            }
        });

        if (!fetchRes.ok) {
            if (fetchRes.status === 504) {
                return { success: false, message: 'YouTube playlist feed timed out after 4000ms. Please try again later.' };
            }
            if (fetchRes.status === 413) {
                return { success: false, message: 'Playlist feed is too large to import (exceeds 500KB limit).' };
            }
            return { success: false, message: 'Failed to fetch playlist from YouTube. Please ensure the playlist is Public or Unlisted.' };
        }

        const xmlText = fetchRes.data;
        if (!xmlText) {
            return { success: false, message: 'Received empty playlist feed from YouTube.' };
        }

        let result: ParsedYouTubePlaylistFeed;
        try {
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: '@_'
            });
            result = parser.parse(xmlText) as ParsedYouTubePlaylistFeed;
        } catch (parseErr) {
            console.error('XML parsing error for YouTube playlist:', parseErr);
            return { success: false, message: 'Malformed XML received from YouTube playlist feed.' };
        }

        const feed = result?.feed;
        if (!feed) {
            return { success: false, message: 'Invalid playlist feed data received from YouTube.' };
        }

        const playlistTitle = feed.title || `Imported Playlist ${playlistId.slice(0, 6)}`;
        const authorName = feed.author?.name || 'YouTube';

        const rawEntries = (Array.isArray(feed.entry) ? feed.entry : (feed.entry ? [feed.entry] : [])).slice(0, 50);
        if (rawEntries.length === 0) {
            return { success: false, message: 'Playlist contains no videos.' };
        }

        // First video thumbnail as playlist cover
        const firstEntry = rawEntries[0];
        const firstVideoId = firstEntry['yt:videoId'] || '';
        const playlistThumbnail = firstEntry['media:group']?.['media:thumbnail']?.['@_url'] || (firstVideoId ? `https://img.youtube.com/vi/${firstVideoId}/maxresdefault.jpg` : null);

        // 1. Create Playlist
        const { data: createdPlaylist, error: plError } = await supabase
            .from('youtube_playlists')
            .insert({
                user_id: user.id,
                title: playlistTitle,
                description: `Imported from YouTube (${authorName}) • ${rawEntries.length} videos`,
                thumbnail_url: playlistThumbnail,
                is_favorite: false
            })
            .select()
            .single();

        if (plError || !createdPlaylist) {
            return { success: false, message: plError?.message || 'Failed to create playlist in database.' };
        }

        // 2. Resolve and insert videos in batches. This avoids one database round trip
        // per playlist entry, which can exceed a Worker request budget on larger feeds.
        const importedVideos = rawEntries.flatMap((entry, position) => {
            const videoId = entry['yt:videoId'];
            if (!videoId) return [];
            return [{
                position,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                title: entry.title || entry['media:group']?.['media:title'] || `Video ${videoId}`,
                thumbnail_url: entry['media:group']?.['media:thumbnail']?.['@_url'] || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
            }];
        });
        const uniqueVideos = Array.from(new Map(importedVideos.map(video => [video.url, video])).values());
        const { data: existingVideos, error: existingVideosError } = await supabase
            .from('youtube_videos')
            .select('id, url')
            .eq('user_id', user.id)
            .in('url', uniqueVideos.map(video => video.url));

        if (existingVideosError) throw existingVideosError;

        const existingByUrl = new Map((existingVideos || []).map(video => [video.url, video.id]));
        const videosToCreate = uniqueVideos
            .filter(video => !existingByUrl.has(video.url))
            .map(({ position: _position, ...video }) => ({ ...video, user_id: user.id, saved_time: 0, is_favorite: false }));

        if (videosToCreate.length > 0) {
            const { data: newVideos, error: newVideosError } = await supabase
                .from('youtube_videos')
                .insert(videosToCreate)
                .select('id, url');
            if (newVideosError) throw newVideosError;
            for (const video of newVideos || []) existingByUrl.set(video.url, video.id);
        }

        const seenVideoIds = new Set<string>();
        const playlistItems = importedVideos.flatMap(video => {
            const videoId = existingByUrl.get(video.url);
            if (!videoId || seenVideoIds.has(videoId)) return [];
            seenVideoIds.add(videoId);
            return [{ user_id: user.id, playlist_id: createdPlaylist.id, video_id: videoId, position: video.position }];
        });

        if (playlistItems.length > 0) {
            const { error: itemsError } = await supabase
                .from('youtube_playlist_items')
                .insert(playlistItems);
            if (itemsError) throw itemsError;
        }

        const addedCount = playlistItems.length;

        revalidatePath('/media/youtube');
        return {
            success: true,
            playlistId: createdPlaylist.id,
            videoCount: addedCount,
            message: `Successfully imported "${playlistTitle}" with ${addedCount} videos!`
        };
    } catch (err: unknown) {
        console.error('Import playlist failed:', err);
        return {
            success: false,
            message: err instanceof Error ? err.message : 'Unknown error occurred during playlist import.'
        };
    }
}
