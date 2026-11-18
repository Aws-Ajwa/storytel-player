import React, {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Link} from 'react-router-dom';
import {useAudioContext} from '../contexts/AudioContext';
import {newStudyBook, reviewSchedule, StudyBook, StudyNote, StudySession, useStudyLibrary} from '../hooks/useStudyLibrary';

const timestamp = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};
const fieldClass = 'w-full rounded bg-gray-800 border border-gray-600 p-2 text-white';
const buttonClass = 'rounded border border-gray-600 px-3 py-2 hover:bg-gray-700 disabled:opacity-50';

interface Props {
    consumableId: string;
    routeId: string;
    title: string;
    author: string;
}

function TextField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
    return <label className="block space-y-1"><span>{label}</span>
        <textarea dir="auto" className={fieldClass} rows={2} value={value} onChange={event => onChange(event.target.value)}/>
    </label>;
}

export default function StudyPanel({consumableId, routeId, title, author}: Props) {
    const {t} = useTranslation();
    const audio = useAudioContext();
    const study = useStudyLibrary();
    const book = study.library.books[consumableId] || newStudyBook(consumableId, routeId, title, author);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('plan');
    const [notice, setNotice] = useState('');
    const [showNotes, setShowNotes] = useState(false);
    const [showPrevious, setShowPrevious] = useState(false);
    const [revealed, setRevealed] = useState<string | null>(null);
    const [reviewAttempt, setReviewAttempt] = useState('');
    const [listenedSeconds, setListenedSeconds] = useState(0);
    const [reminderMinutes, setReminderMinutes] = useState(20);
    const positionRef = useRef(audio.currentTime);
    positionRef.current = audio.currentTime;
    const session = book.sessions.find(item => !item.endedAt);
    const previous = book.sessions.filter(item => item.endedAt).slice(-1)[0];
    const save = (change: (current: StudyBook) => StudyBook) => study.updateBook(book, change);
    const setBookField = (key: 'goal' | 'questions' | 'conclusion' | 'application' | 'applicationDate' | 'applicationResult', value: string) => {
        save(current => ({...current, [key]: value}));
    };
    const editSession = (changes: Partial<StudySession>) => save(current => ({...current,
        sessions: current.sessions.map(item => item.id === session?.id ? {...item, ...changes} : item),
    }));
    const editNote = (id: string, changes: Partial<StudyNote>) => save(current => ({...current,
        notes: current.notes.map(note => note.id === id ? {...note, ...changes} : note),
    }));
    const pause = () => { if (audio.isPlaying) audio.togglePlayPause(); };
    const makeSession = (): StudySession => ({
        id: crypto.randomUUID(), startedAt: new Date().toISOString(), endedAt: null,
        startMs: Math.floor(audio.currentTime * 1000), endMs: Math.floor(audio.currentTime * 1000),
        recall: '', summary: '', nextQuestion: '', priorRecall: '', segments: [],
    });
    const capture = () => {
        const active = session || makeSession();
        const note: StudyNote = {
            id: crypto.randomUUID(), sessionId: active.id, positionMs: Math.floor(audio.currentTime * 1000),
            createdAt: new Date().toISOString(), text: '', question: '', answer: '', dueAt: null,
            intervalDays: 0, important: false,
        };
        save(current => ({...current, title, author, routeId,
            sessions: session ? current.sessions : [...current.sessions, active], notes: [...current.notes, note],
        }));
        setNotice(t('study.captured', {time: timestamp(note.positionMs)}));
    };

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const target = event.target;
            if ((target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"]')) || event.repeat) return;
            if (event.code === 'KeyM' && !event.ctrlKey && !event.metaKey && !event.altKey && study.ready) {
                event.preventDefault();
                capture();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    });

    useEffect(() => {
        if (!session || !audio.isPlaying || book.returnPositionMs !== null) return;
        const timer = window.setInterval(() => setListenedSeconds(value => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [session?.id, audio.isPlaying, book.returnPositionMs]);

    // Retain the active session across navigation and unexpected app restarts.
    useEffect(() => {
        if (!session) return;
        const savePosition = () => study.updateBook(book, current => current.returnPositionMs !== null ? current : ({...current,
            sessions: current.sessions.map(item => item.id === session.id && !item.endedAt
                ? {...item, endMs: Math.floor(positionRef.current * 1000)} : item),
        }));
        const timer = window.setInterval(savePosition, 15000);
        return () => { window.clearInterval(timer); savePosition(); };
    }, [session?.id]);

    const replay = (positionMs: number) => {
        save(current => current.returnPositionMs === null ? {...current,
            returnPositionMs: Math.floor(audio.currentTime * 1000), returnWasPlaying: audio.isPlaying,
        } : current);
        audio.seek(Math.max(0, positionMs / 1000 - 30));
        if (!audio.isPlaying) audio.togglePlayPause();
    };
    const returnToListening = () => {
        if (book.returnPositionMs === null) return;
        audio.seek(book.returnPositionMs / 1000);
        if (audio.isPlaying !== book.returnWasPlaying) audio.togglePlayPause();
        save(current => ({...current, returnPositionMs: null, returnWasPlaying: false}));
    };
    const checkpoint = () => {
        if (!session || !session.recall.trim()) return;
        const startMs = session.segments?.slice(-1)[0]?.endMs ?? session.startMs;
        editSession({segments: [...(session.segments || []), {
            id: crypto.randomUUID(), startMs, endMs: Math.floor(audio.currentTime * 1000), recall: session.recall,
        }], recall: '', endMs: Math.floor(audio.currentTime * 1000)});
        setListenedSeconds(0);
        setShowNotes(true);
    };
    const due = Object.values(study.library.books).flatMap(source => source.notes
        .filter(note => note.dueAt && Date.parse(note.dueAt) <= Date.now() && note.question.trim() && note.answer.trim())
        .map(note => ({source, note})));
    const review = due[0];

    return <section className="px-3 py-4 space-y-4 border-t border-gray-700" aria-label={t('study.title')}>
        <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded bg-orange-600 px-4 py-2 disabled:opacity-50" disabled={!study.ready || book.returnPositionMs !== null}
                onClick={capture} title={t('study.captureShortcut')}>{t('study.capture')} (M)</button>
            <button type="button" className={buttonClass} aria-expanded={open} onClick={() => setOpen(value => !value)}>{t('study.title')}</button>
            <span className="text-sm text-gray-300" role="status">{study.error ? t('study.saveError') : study.saving ? t('study.saving') : study.ready ? t('study.saved') : t('study.loading')}</span>
            {study.error && <button type="button" className={buttonClass} onClick={study.retry}>{t('study.retry')}</button>}
        </div>
        <p role="status" className="text-sm">{notice}</p>
        {book.returnPositionMs !== null && <button type="button" className={buttonClass} onClick={returnToListening}>{t('study.return', {time: timestamp(book.returnPositionMs)})}</button>}
        {session && listenedSeconds >= reminderMinutes * 60 && <div role="status" className="flex flex-wrap items-center gap-3">
            <span>{t('study.reminder')}</span>
            <button type="button" className={buttonClass} onClick={() => { pause(); setOpen(true); setTab('session'); setShowNotes(false); }}>{t('study.pauseRecall')}</button>
            <button type="button" className={buttonClass} onClick={() => setListenedSeconds(0)}>{t('study.later')}</button>
        </div>}
        {open && study.ready && <>
            <nav className="flex flex-wrap gap-2" aria-label={t('study.title')}>
                {['plan', 'session', 'notes', 'reviews', 'finish'].map(item => <button type="button" key={item} className={`${buttonClass} ${tab === item ? 'bg-gray-700' : ''}`}
                    aria-pressed={tab === item} onClick={() => { if (item === 'reviews' || item === 'notes') pause(); setTab(item); }}>{t(`study.${item}`)}{item === 'reviews' ? ` (${due.length})` : ''}</button>)}
            </nav>
            {tab === 'plan' && <div className="space-y-4">
                <TextField label={t('study.goal')} value={book.goal} onChange={value => setBookField('goal', value)}/>
                <TextField label={t('study.questions')} value={book.questions} onChange={value => setBookField('questions', value)}/>
            </div>}
            {tab === 'session' && <div className="space-y-4">
                {!session ? <button type="button" className={buttonClass} onClick={() => {
                    pause(); save(current => ({...current, title, author, routeId, sessions: [...current.sessions, makeSession()]}));
                    setShowPrevious(false); setShowNotes(false); setListenedSeconds(0);
                }}>{t('study.start')}</button> : <>
                    <TextField label={t('study.priorRecall')} value={session.priorRecall} onChange={value => editSession({priorRecall: value})}/>
                    {previous && <>
                        <button type="button" className={buttonClass} onClick={() => setShowPrevious(value => !value)}>{t('study.showPrevious')}</button>
                        {showPrevious && <div className="whitespace-pre-wrap" dir="auto"><p>{previous.summary}</p><p>{previous.nextQuestion}</p>
                            {previous.segments?.map(segment => <p key={segment.id}>{segment.recall}</p>)}</div>}
                    </>}
                    <label className="flex flex-wrap items-center gap-2">{t('study.reminderInterval')}
                        <select className="rounded bg-gray-800 p-2" value={reminderMinutes} onChange={event => setReminderMinutes(Number(event.target.value))}>
                            {[15, 20, 25, 30].map(minutes => <option key={minutes} value={minutes}>{t('study.minutes', {count: minutes})}</option>)}
                        </select>
                    </label>
                    <button type="button" className={buttonClass} onClick={() => { pause(); setShowNotes(false); }}>{t('study.pauseRecall')}</button>
                    <TextField label={t('study.recallPrompt')} value={session.recall} onChange={value => editSession({recall: value})}/>
                    <button type="button" className={buttonClass} disabled={!session.recall.trim() || book.returnPositionMs !== null} onClick={checkpoint}>{t('study.saveRecall')}</button>
                    <button type="button" className={buttonClass} onClick={() => setShowNotes(value => !value)}>{t('study.showMarks')}</button>
                    {showNotes && <div className="space-y-2">{book.notes.filter(note => note.sessionId === session.id).map(note => <div key={note.id} className="flex flex-wrap gap-2 items-center">
                        <button type="button" className={buttonClass} onClick={() => replay(note.positionMs)}>{timestamp(note.positionMs)} · {t('study.replay')}</button>
                        <span dir="auto">{note.text || t('study.emptyNote')}</span>
                        <button type="button" className={buttonClass} onClick={() => setTab('notes')}>{t('study.editNotes')}</button>
                    </div>)}</div>}
                    <TextField label={t('study.summary')} value={session.summary} onChange={value => editSession({summary: value})}/>
                    <TextField label={t('study.nextQuestion')} value={session.nextQuestion} onChange={value => editSession({nextQuestion: value})}/>
                    <button type="button" className={buttonClass} disabled={book.returnPositionMs !== null} onClick={() => {
                        pause(); editSession({endedAt: new Date().toISOString(), endMs: Math.floor(audio.currentTime * 1000)});
                        setListenedSeconds(0); setNotice(t('study.sessionEnded'));
                    }}>{t('study.end')}</button>
                </>}
                <details><summary>{t('study.history')}</summary><div className="space-y-4 pt-3">
                    {book.sessions.filter(item => item.endedAt).slice().reverse().map(item => <div key={item.id} className="space-y-2 border-b border-gray-700 pb-3">
                        <p>{new Date(item.startedAt).toLocaleString()} · {timestamp(item.startMs)}–{timestamp(item.endMs)}</p>
                        <p className="whitespace-pre-wrap" dir="auto">{item.summary}</p><p dir="auto">{item.nextQuestion}</p>
                        <p className="whitespace-pre-wrap" dir="auto">{item.recall}</p>
                        {item.segments?.map(segment => <p key={segment.id} className="whitespace-pre-wrap" dir="auto">{timestamp(segment.startMs)}–{timestamp(segment.endMs)} · {segment.recall}</p>)}
                    </div>)}
                </div></details>
            </div>}
            {tab === 'notes' && <div className="space-y-6">
                {book.notes.length === 0 && <p>{t('study.noNotes')}</p>}
                {book.notes.map(note => <article key={note.id} className="space-y-3 border-b border-gray-700 pb-5">
                    <button type="button" className={buttonClass} onClick={() => replay(note.positionMs)}>{timestamp(note.positionMs)} · {t('study.replay')}</button>
                    <TextField label={t('study.noteText')} value={note.text} onChange={value => editNote(note.id, {text: value})}/>
                    <TextField label={t('study.question')} value={note.question} onChange={value => editNote(note.id, {question: value})}/>
                    <TextField label={t('study.answer')} value={note.answer} onChange={value => editNote(note.id, {answer: value})}/>
                    <div className="flex flex-wrap gap-3 items-center">
                        <button type="button" className={buttonClass} disabled={!note.question.trim() || !note.answer.trim()} onClick={() => editNote(note.id, {
                            dueAt: note.dueAt ? null : new Date(Date.now() + 86400000).toISOString(), intervalDays: 0,
                        })}>{t(note.dueAt ? 'study.unschedule' : 'study.schedule')}</button>
                        {note.dueAt && <span>{t('study.nextReview', {date: new Date(note.dueAt).toLocaleDateString()})}</span>}
                        <label className="flex gap-2 items-center"><input type="checkbox" checked={note.important} onChange={event => editNote(note.id, {important: event.target.checked})}/>{t('study.important')}</label>
                        <button type="button" className={buttonClass} onClick={() => {
                            if (window.confirm(t('study.confirmDelete'))) save(current => ({...current, notes: current.notes.filter(item => item.id !== note.id)}));
                        }}>{t('study.delete')}</button>
                    </div>
                </article>)}
            </div>}
            {tab === 'reviews' && <div className="space-y-4">
                {!review ? <p>{t('study.noReviews')}</p> : <>
                    <p>{review.source.title} · {timestamp(review.note.positionMs)}</p>
                    <p dir="auto" className="text-lg">{review.note.question}</p>
                    <TextField label={t('study.attempt')} value={reviewAttempt} onChange={setReviewAttempt}/>
                    <button type="button" className={buttonClass} onClick={() => setRevealed(review.note.id)}>{t('study.reveal')}</button>
                    {revealed === review.note.id && <>
                        <p dir="auto" className="whitespace-pre-wrap">{review.note.answer}</p>
                        {review.source.consumableId === consumableId
                            ? <button type="button" className={buttonClass} onClick={() => replay(review.note.positionMs)}>{t('study.replay')}</button>
                            : <Link className={buttonClass} to={`/player/${review.source.routeId}`}>{t('study.openSource')}</Link>}
                        <div className="flex flex-wrap gap-2">{(['again', 'partial', 'remembered'] as const).map(rating => <button type="button" key={rating} className={buttonClass} onClick={() => {
                            study.updateBook(review.source, current => ({...current, notes: current.notes.map(note => note.id === review.note.id
                                ? {...note, ...reviewSchedule(note.intervalDays, rating)} : note)}));
                            setRevealed(null); setReviewAttempt('');
                        }}>{t(`study.${rating}`)}</button>)}</div>
                    </>}
                </>}
            </div>}
            {tab === 'finish' && <div className="space-y-4">
                <p dir="auto" className="whitespace-pre-wrap">{book.goal}</p><p dir="auto" className="whitespace-pre-wrap">{book.questions}</p>
                <TextField label={t('study.conclusion')} value={book.conclusion} onChange={value => setBookField('conclusion', value)}/>
                {book.notes.filter(note => note.important).map(note => <p key={note.id} dir="auto">{timestamp(note.positionMs)} · {note.text}</p>)}
                <TextField label={t('study.application')} value={book.application} onChange={value => setBookField('application', value)}/>
                <label className="block space-y-1"><span>{t('study.applicationDate')}</span><input type="date" className={fieldClass} value={book.applicationDate} onChange={event => setBookField('applicationDate', event.target.value)}/></label>
                <TextField label={t('study.result')} value={book.applicationResult} onChange={value => setBookField('applicationResult', value)}/>
            </div>}
        </>}
    </section>;
}
