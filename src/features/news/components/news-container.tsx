import { notFound } from 'next/navigation';
import React from 'react';
import {
    Globe, Zap, Languages, Trophy, Cpu, Gamepad,
    HeartPulse, Tv, Briefcase, GraduationCap,
    type LucideIcon, Radio
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';

// Modular Components
import { NewsSidebar } from '@/features/news/components/news-sidebar';
import { FeaturedArticle } from '@/features/news/components/featured-article';
import { NewsGrid } from '@/features/news/components/news-grid';
import { NewsItem } from '@/features/news/types';
import { PageShell } from '@/components/layout/page-shell';

import { getNews } from '@/features/news/services/news';
import { CATEGORIES } from '@/features/news/constants/feeds';

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
    Globe, Zap, Languages, Trophy, Cpu, Gamepad,
    HeartPulse, Tv, Briefcase, GraduationCap,
};

interface NewsContainerProps {
    locale: string;
    categoryId: string;
}

export async function NewsContainer({ locale, categoryId }: NewsContainerProps) {
    const category = CATEGORIES.find(c => c.id === categoryId);
    if (!category && categoryId !== 'all') {
        notFound();
    }

    const [t, tCategories, newsItems] = await Promise.all([
        getTranslations({ locale, namespace: 'media.news' }),
        getTranslations({ locale, namespace: 'media.news.categories' }),
        getNews(categoryId === 'all' ? undefined : categoryId)
    ]);

    if (newsItems.length === 0 && categoryId === 'all') {
        return (
            <PageShell variant="landing" className="bg-background text-center pt-32 font-mono space-y-4">
                <h2 className="text-xl font-bold uppercase text-white">// {t('noNews')}</h2>
                <p className="text-primary/60 text-xs uppercase">// {t('tryAgain')}</p>
            </PageShell>
        );
    }

    const featuredItems: NewsItem[] = [];
    if (categoryId === 'all') {
        const seenSources = new Set<string>();
        for (const item of newsItems) {
            if (!seenSources.has(item.author) && featuredItems.length < 5) {
                featuredItems.push(item);
                seenSources.add(item.author);
            }
        }
        if (featuredItems.length < 5) {
            for (const item of newsItems) {
                if (featuredItems.length >= 5) break;
                if (!featuredItems.some(fi => fi.link === item.link)) {
                    featuredItems.push(item);
                }
            }
        }
    } else {
        featuredItems.push(...newsItems.slice(0, 5));
    }

    const featuredLinks = new Set(featuredItems.map(i => i.link));
    const remainingItems = newsItems.filter(i => !featuredLinks.has(i.link));

    const trendingItems: NewsItem[] = categoryId === 'all'
        ? remainingItems.slice(0, 10)
        : (remainingItems.length >= 5 ? remainingItems.slice(0, 10) : newsItems.slice(0, 10));

    const feedItems = categoryId === 'all' ? remainingItems.slice(10) : remainingItems;

    const CATEGORIES_WITH_ICONS = CATEGORIES.map(cat => {
        const IconComponent = CATEGORY_ICON_MAP[cat.icon as string] || Globe;
        return {
            ...cat,
            icon: React.createElement(IconComponent, { className: "w-4 h-4" })
        };
    });

    return (
        <PageShell variant="landing" className="text-slate-200 overflow-x-hidden pt-20">
            <div className="flex flex-col lg:flex-row min-h-[calc(100vh-64px)] overflow-hidden">
                <NewsSidebar categories={CATEGORIES_WITH_ICONS} trendingItems={trendingItems} />

                <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
                        <div className="px-4 md:px-8 py-8 space-y-10 max-w-6xl mx-auto">
                            {/* Category Header */}
                            {categoryId !== 'all' && (
                                <div className="border-b border-primary/20 pb-4 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Radio className="w-3.5 h-3.5 text-primary animate-pulse" />
                                        <span className="text-[10px] font-mono uppercase tracking-widest text-primary/60">// NEWS_FEED_CATEGORY</span>
                                    </div>
                                    <h1 className="text-xl sm:text-2xl font-mono font-bold text-white uppercase tracking-wider">
                                        {tCategories(categoryId)}
                                    </h1>
                                    <p className="text-xs font-mono text-primary/60 uppercase">
                                        // {t('categoryDescription', { category: tCategories(categoryId) })}
                                    </p>
                                </div>
                            )}

                            {featuredItems.length > 0 && (
                                <FeaturedArticle items={featuredItems} />
                            )}

                            <NewsGrid items={feedItems} />
                        </div>
                    </div>
                </main>
            </div>
        </PageShell>
    );
}
