import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookShelfEntity } from '../interfaces/books';
import api, { trackAction } from '../utils/api';

export const downloadsChanged = 'downloadsChanged';
const pendingDownloads = new Set<string>();

export function useBookDownload(bookId: string | undefined, consumableId: string, book: BookShelfEntity | null) {
    const { t } = useTranslation();
    const [downloadedBookId, setDownloadedBookId] = useState<string>();
    const [isDownloading, setIsDownloading] = useState(false);

    useEffect(() => {
        if (!bookId) return;

        let revision = 0;
        const refresh = async () => {
            const request = ++revision;
            const pending = pendingDownloads.has(bookId);
            setIsDownloading(pending);
            if (pending) return;

            try {
                const { data } = await api.get<{ downloaded: boolean }>(`/download-status/${bookId}`);
                if (revision === request) setDownloadedBookId(data.downloaded ? bookId : undefined);
            } catch (error) {
                console.error('Failed to check download status:', error);
            }
        };

        void refresh();
        window.addEventListener(downloadsChanged, refresh);
        return () => {
            revision++;
            window.removeEventListener(downloadsChanged, refresh);
        };
    }, [bookId]);

    const download = async (): Promise<string | undefined> => {
        if (!bookId || pendingDownloads.has(bookId)) return;

        pendingDownloads.add(bookId);
        window.dispatchEvent(new Event(downloadsChanged));
        try {
            void trackAction('User initiated download', { bookId, bookName: book?.book?.name });
            const { data } = await api.post<{ success: boolean; error?: string }>(
                '/download',
                { bookId, consumableId, book },
                { timeout: 0 },
            );
            if (data.success || data.error === 'Download cancelled') return;
            return data.error || t('download.failed');
        } catch (error: any) {
            if (error?.response?.status === 403) return t('player.accessDenied');

            const message = error?.response?.data?.error || error?.data?.error || error?.message;
            if (message === 'Download cancelled' || message === 'canceled') return;
            return message || t('download.failed');
        } finally {
            pendingDownloads.delete(bookId);
            window.dispatchEvent(new Event(downloadsChanged));
        }
    };

    return { isDownloaded: !!bookId && downloadedBookId === bookId, isDownloading, download };
}
