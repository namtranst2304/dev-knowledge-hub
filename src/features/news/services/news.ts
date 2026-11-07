import { XMLParser } from 'fast-xml-parser';
import { NewsItem } from '@/features/news/types';
import { FEEDS, CATEGORIES } from '@/features/news/constants/feeds';
import { resilientFetch } from '@/lib/resilience/resilient-fetch';

export { FEEDS, CATEGORIES };

interface RawRSSItem {
    title?: string;
    link?: string;
    description?: string;
    pubDate?: string;
    image?: string;
    thumb?: string;
    "content:encoded"?: string;
    "media:thumbnail"?: { url?: string };
    "media:content"?: { url?: string } | { url?: string }[];
    enclosure?: { url?: string; type?: string };
}

interface ParsedRSSResult {
    rss?: {
        channel?: {
            item?: RawRSSItem | RawRSSItem[];
        };
    };
}

const DEFAULT_NEWS_THUMBNAIL = "https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=2070&auto=format&fit=crop";

// In-memory news cache (3 minutes TTL) to prevent repeated RSS fetching and parsing
const newsMemoryCache = new Map<string, { data: NewsItem[]; timestamp: number }>();
const NEWS_CACHE_TTL_MS = 180 * 1000;

export async function getNews(categoryId?: string): Promise<NewsItem[]> {
    const cacheKey = categoryId || 'all';
    const cached = newsMemoryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < NEWS_CACHE_TTL_MS) {
        return cached.data;
    }

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        parseTagValue: false
    });

    const targetFeeds = categoryId && categoryId !== 'all'
        ? FEEDS.filter(f => (f as { category?: string }).category === categoryId)
        : FEEDS.filter(f => !(f as { category?: string }).category);

    const allNewsPromises = targetFeeds.map(async (feed) => {
        try {
            const fetchRes = await resilientFetch<string>(feed.url, {
                timeoutMs: 3800, // 3500ms-4000ms strict timeout boundary
                maxBytes: 500 * 1024, // 500KB payload cap to protect Worker memory & CPU
                responseType: 'text',
                retries: 0,
                headers: {
                    'User-Agent': 'DevKnowledgeHub-RSS-Bot/1.0',
                    'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
                }
            });

            if (!fetchRes.ok || !fetchRes.data) {
                if (fetchRes.status === 504) {
                    console.error(`Timeout fetching RSS from ${feed.url} (exceeded 3800ms)`);
                } else if (fetchRes.status === 413) {
                    console.error(`RSS feed ${feed.url} rejected: payload exceeds 500KB cap`);
                } else {
                    console.error(`Error fetching RSS from ${feed.url}: status ${fetchRes.status}`);
                }
                return [];
            }

            let result: ParsedRSSResult;
            try {
                result = parser.parse(fetchRes.data) as ParsedRSSResult;
            } catch (parseErr) {
                console.error(`Malformed XML from ${feed.url}:`, parseErr);
                return [];
            }

            if (!result?.rss?.channel) return [];

            const channel = result.rss.channel;
            const rawItems = Array.isArray(channel.item) ? channel.item : (channel.item ? [channel.item] : []);
            const items = rawItems.slice(0, 15).filter((item): item is RawRSSItem => !!item);

            return items.map((item) => {
                const imageUrl = extractImageUrl(item) || DEFAULT_NEWS_THUMBNAIL;
                const rawDesc = String(item.description ?? "");
                // Streamline string processing for Cloudflare Worker 10ms CPU limits:
                // Truncate to first 800 chars before regex HTML stripping and taking first sentence
                const shortDesc = rawDesc.length > 800 ? rawDesc.slice(0, 800) : rawDesc;
                const strippedDesc = shortDesc.includes('<') ? shortDesc.replace(/<[^>]*>/g, "") : shortDesc;
                const firstSentence = (strippedDesc.split(".")[0] || "").trim();
                const cleanDescription = firstSentence ? decodeEntities(`${firstSentence}.`).normalize('NFC') : "";
                const title = decodeEntities(String(item.title ?? "").trim()).normalize('NFC');
                const parsedPubDate = item.pubDate ? new Date(item.pubDate) : null;
                const pubDate = parsedPubDate && !Number.isNaN(parsedPubDate.getTime()) ? parsedPubDate : new Date();

                return {
                    title: title,
                    link: item.link ? String(item.link) : "",
                    excerpt: cleanDescription,
                    time: pubDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
                    pubDate: pubDate,
                    category: categoryId ? CATEGORIES.find(c => c.id === categoryId)?.name || "" : "Latest",
                    categoryId: categoryId || 'all',
                    image: imageUrl,
                    author: feed.author,
                    sourceLogo: feed.logo,
                    isoDate: pubDate.toISOString()
                } as NewsItem & { pubDate: Date };
            });
        } catch (error) {
            console.error(`Error processing RSS from ${feed.url}:`, error);
            return [];
        }
    });

    try {
        const results = await Promise.all(allNewsPromises);
        const mergedNews = (results.flat() as (NewsItem & { pubDate: Date })[]).filter(item => item != null);

        // Deduplicate by link to prevent duplicate React keys
        const seenLinks = new Set<string>();
        const uniqueNews = mergedNews.filter(item => {
            if (seenLinks.has(item.link)) return false;
            seenLinks.add(item.link);
            return true;
        });

        const finalNews = uniqueNews
            .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
            .map(({ ...rest }) => rest);

        newsMemoryCache.set(cacheKey, { data: finalNews, timestamp: Date.now() });
        return finalNews;
    } catch (error) {
        console.error("Error aggregating news:", error);
        return [];
    }
}

function extractImageUrl(item: RawRSSItem): string {
    let imageUrl = '';
    const description = item.description || "";
    const contentEncoded = item["content:encoded"] || "";

    // 1. Try media:thumbnail
    if (item["media:thumbnail"]?.url) {
        imageUrl = item["media:thumbnail"].url;
    }

    // 2. Try media:content
    if (!imageUrl && item["media:content"]) {
        const media = Array.isArray(item["media:content"]) ? item["media:content"][0] : item["media:content"];
        if (media?.url) imageUrl = media.url;
    }

    // 3. Try description for <img> tag (fast path: check '<img' first, limit search window to first 3000 chars)
    if (!imageUrl && description && description.includes('<img')) {
        const descSlice = description.length > 3000 ? description.slice(0, 3000) : description;
        const imgMatch = descSlice.match(/<img[^>]+src=['"]([^'"]+)['"]/i) || descSlice.match(/src=['"]([^'"]+)['"]/i);
        if (imgMatch) {
            imageUrl = imgMatch[1];
            if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        }
    }

    // 4. Try direct image or thumb tags
    if (!imageUrl && item.image && typeof item.image === 'string') {
        imageUrl = item.image;
    }
    if (!imageUrl && item.thumb && typeof item.thumb === 'string') {
        imageUrl = item.thumb;
    }

    // 5. Try enclosure (only if image)
    if (!imageUrl && item.enclosure?.url) {
        const type = item.enclosure.type || "";
        if (type.startsWith('image/')) {
            imageUrl = item.enclosure.url;
        }
    }

    // 6. Try content:encoded (fast path: check '<img' first, limit search window to first 3000 chars)
    if (!imageUrl && contentEncoded && contentEncoded.includes('<img')) {
        const contentSlice = contentEncoded.length > 3000 ? contentEncoded.slice(0, 3000) : contentEncoded;
        const imgMatch = contentSlice.match(/<img[^>]+src=['"]([^'"]+)['"]/i);
        if (imgMatch) {
            imageUrl = imgMatch[1];
            if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        }
    }

    // Filter out non-image URLs
    if (imageUrl && (
        imageUrl.includes('soundcloud.com') ||
        imageUrl.includes('player/') ||
        imageUrl.includes('youtube.com/embed') ||
        imageUrl.includes('facebook.com/plugins') ||
        imageUrl.includes('iframe')
    )) {
        return '';
    }

    return imageUrl;
}

const ENTITY_MAP: Record<string, string> = {
    "nbsp": " ", "amp": "&", "quot": "\"", "lt": "<", "gt": ">", "apos": "'",
    "lsquo": "‘", "rsquo": "’", "ldquo": "“", "rdquo": "”", "ndash": "–", "mdash": "—", "hellip": "…",
    "aacute": "á", "agrave": "à", "ả": "ả", "atilde": "ã", "ạ": "ạ",
    "Aacute": "Á", "Agrave": "À", "Ả": "Ả", "Atilde": "Ã", "Ạ": "Ạ",
    "eacute": "é", "egrave": "è", "ẻ": "ẻ", "ẽ": "ẽ", "ẹ": "ẹ",
    "Eacute": "É", "Egrave": "È", "Ẻ": "Ẻ", "Ẽ": "Ẽ", "Ẹ": "Ẹ",
    "iacute": "í", "igrave": "ì", "ỉ": "ỉ", "ĩ": "ĩ", "ị": "ị",
    "Iacute": "Í", "Igrave": "Ì", "Ỉ": "Ỉ", "Ĩ": "Ĩ", "Ị": "Ị",
    "oacute": "ó", "ograve": "ò", "ỏ": "ỏ", "otilde": "õ", "ọ": "ọ",
    "Oacute": "Ó", "Ograve": "Ò", "Ỏ": "Ỏ", "Otilde": "Õ", "Ọ": "Ọ",
    "uacute": "ú", "ugrave": "ù", "ủ": "ủ", "utilde": "ũ", "ụ": "ụ",
    "Uacute": "Ú", "Ugrave": "Ù", "Ủ": "Ủ", "Utilde": "Ũ", "Ụ": "Ụ",
    "yacute": "ý", "ygrave": "ỳ", "ỷ": "ỷ", "ỹ": "ỹ", "ỵ": "ỵ",
    "Yacute": "Ý", "Ygrave": "Ỳ", "Ỷ": "Ỷ", "Ỹ": "Ỹ", "Ỵ": "Ỵ",
    "acirc": "â", "ecirc": "ê", "ocirc": "ô", "ư": "ư", "ơ": "ơ", "đ": "đ",
    "Acirc": "Â", "Ecirc": "Ê", "Ocirc": "Ô", "Ư": "Ư", "Ơ": "Ơ", "Đ": "Đ",
};

function decodeEntities(text: string): string {
    if (!text || !text.includes('&')) return text ? text.trim() : "";

    let decoded = text.replace(/&(?:#(\d+)|#x([\da-fA-F]+)|(\w+));/g, (match, dec, hex, name) => {
        if (dec) return String.fromCharCode(parseInt(dec, 10));
        if (hex) return String.fromCharCode(parseInt(hex, 16));
        if (name && ENTITY_MAP[name]) return ENTITY_MAP[name];
        return match;
    });

    if (decoded.includes('&')) {
        decoded = decoded.replace(/&(?:#(\d+)|#x([\da-fA-F]+)|(\w+));/g, (match, dec, hex, name) => {
            if (dec) return String.fromCharCode(parseInt(dec, 10));
            if (hex) return String.fromCharCode(parseInt(hex, 16));
            if (name && ENTITY_MAP[name]) return ENTITY_MAP[name];
            return match;
        });
    }

    return decoded.trim();
}
