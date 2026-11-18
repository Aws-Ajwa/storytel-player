import {useEffect, useSyncExternalStore} from 'react';
import storage from '../utils/storage';

export interface StudyNote {
    id: string;
    sessionId: string | null;
    positionMs: number;
    createdAt: string;
    text: string;
    question: string;
    answer: string;
    dueAt: string | null;
    intervalDays: number;
    important: boolean;
}

export interface StudySession {
    id: string;
    startedAt: string;
    endedAt: string | null;
    startMs: number;
    endMs: number;
    recall: string;
    summary: string;
    nextQuestion: string;
    priorRecall: string;
    segments: {id: string; startMs: number; endMs: number; recall: string}[];
}

export interface StudyBook {
    consumableId: string;
    routeId: string;
    title: string;
    author: string;
    goal: string;
    questions: string;
    notes: StudyNote[];
    sessions: StudySession[];
    conclusion: string;
    application: string;
    applicationDate: string;
    applicationResult: string;
    returnPositionMs: number | null;
    returnWasPlaying: boolean;
}

interface StudyLibrary {
    schemaVersion: 1;
    books: Record<string, StudyBook>;
}

// Versioned, local source records retain stable IDs and audio timestamps for future exports.
const storageKey = 'study_library_v1';
let state = {
    library: {schemaVersion: 1, books: {}} as StudyLibrary,
    ready: false,
    error: false,
    saving: false,
};
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
let writes = Promise.resolve();
let revision = 0;
const publish = () => listeners.forEach(listener => listener());

async function load() {
    try {
        const raw = await storage.get(storageKey);
        const library = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : state.library;
        if (library.schemaVersion !== 1 || !library.books || typeof library.books !== 'object' || Array.isArray(library.books) ||
            !Object.values(library.books).every((value: any) => value && typeof value.consumableId === 'string' &&
                typeof value.title === 'string' && Array.isArray(value.notes) && Array.isArray(value.sessions))) {
            throw new Error('Unsupported study library');
        }
        state = {...state, library, ready: true, error: false};
    } catch {
        state = {...state, error: true};
        loading = undefined;
    }
    publish();
}

function persist() {
    const snapshot = JSON.stringify(state.library);
    const currentRevision = ++revision;
    state = {...state, saving: true};
    publish();
    writes = writes.then(async () => {
        try {
            await storage.set(storageKey, snapshot);
            if (revision === currentRevision) state = {...state, saving: false, error: false};
        } catch {
            if (revision === currentRevision) state = {...state, saving: false, error: true};
        }
        publish();
    });
}

export function newStudyBook(consumableId: string, routeId: string, title: string, author: string): StudyBook {
    return {
        consumableId, routeId, title, author, goal: '', questions: '', notes: [], sessions: [],
        conclusion: '', application: '', applicationDate: '', applicationResult: '',
        returnPositionMs: null, returnWasPlaying: false,
    };
}

export function reviewSchedule(intervalDays: number, rating: 'again' | 'partial' | 'remembered', now = Date.now()) {
    const days = rating === 'again' ? 1 : rating === 'partial' ? 3 : Math.max(7, intervalDays * 2);
    return {intervalDays: days, dueAt: new Date(now + days * 86400000).toISOString()};
}

export function useStudyLibrary() {
    const snapshot = useSyncExternalStore(listener => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, () => state);
    useEffect(() => { loading ??= load(); }, []);

    const updateBook = (book: StudyBook, change: (current: StudyBook) => StudyBook) => {
        if (!state.ready) return;
        const current = state.library.books[book.consumableId] || book;
        state = {...state, library: {...state.library, books: {
            ...state.library.books, [book.consumableId]: change(current),
        }}};
        persist();
    };

    return {...snapshot, updateBook, retry: () => {
        if (state.ready) persist();
        else loading = load();
    }};
}
