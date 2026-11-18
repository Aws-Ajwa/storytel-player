import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import {act, create, ReactTestRenderer} from 'react-test-renderer';
import type {useStudyLibrary as StudyHook} from '../src/hooks/useStudyLibrary';

test('study persistence protects existing data, serializes rapid edits, and recovers failed writes', async () => {
    let stored: unknown = '{broken json';
    let failWrite = false;
    let releaseWrite: (() => void) | undefined;
    let waitForWrite: Promise<void> | undefined;
    const writes: string[] = [];
    Object.defineProperty(globalThis, 'window', {configurable: true, value: {
        electronStore: {
            get: async () => stored,
            set: async (_key: string, value: string) => {
                await waitForWrite;
                if (failWrite) throw new Error('Disk unavailable');
                stored = value;
                writes.push(value);
            },
        },
    }});
    const {useStudyLibrary, newStudyBook, reviewSchedule} = await import('../src/hooks/useStudyLibrary');
    let study!: ReturnType<typeof StudyHook>;
    function Probe() {
        study = useStudyLibrary();
        return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Probe/>); });
    assert.equal(study.ready, false);
    assert.equal(study.error, true);
    const first = newStudyBook('audio-1', 'book-1', 'كتاب', 'مؤلف');
    await act(async () => { study.updateBook(first, value => ({...value, goal: 'Should not replace corrupt data'})); });
    assert.equal(writes.length, 0);

    stored = JSON.stringify({schemaVersion: 1, books: {}});
    await act(async () => { study.retry(); });
    assert.equal(study.ready, true);
    waitForWrite = new Promise(resolve => { releaseWrite = resolve; });
    const second = newStudyBook('audio-2', 'book-2', 'Second book', 'Author');
    await act(async () => {
        study.updateBook(first, value => ({...value, goal: 'فهم التفاوض'}));
        study.updateBook(first, value => ({...value, questions: 'لماذا؟'}));
        study.updateBook(second, value => ({...value, goal: 'Another goal'}));
    });
    assert.equal(study.saving, true);
    await act(async () => { releaseWrite!(); });
    assert.equal(study.saving, false);
    const saved = JSON.parse(stored as string);
    assert.equal(saved.books['audio-1'].goal, 'فهم التفاوض');
    assert.equal(saved.books['audio-1'].questions, 'لماذا؟');
    assert.equal(saved.books['audio-2'].goal, 'Another goal');

    failWrite = true;
    await act(async () => { study.updateBook(first, value => ({...value, conclusion: 'Keep this draft'})); });
    assert.equal(study.error, true);
    assert.equal(study.library.books['audio-1'].conclusion, 'Keep this draft');
    failWrite = false;
    await act(async () => { study.retry(); });
    assert.equal(study.error, false);
    assert.equal(JSON.parse(stored as string).books['audio-1'].conclusion, 'Keep this draft');
    await act(async () => { renderer.unmount(); renderer = create(<Probe/>); });
    assert.equal(study.library.books['audio-1'].conclusion, 'Keep this draft');

    const now = Date.parse('2026-11-18T12:00:00Z');
    assert.equal(reviewSchedule(7, 'again', now).dueAt, '2026-11-19T12:00:00.000Z');
    assert.equal(reviewSchedule(7, 'partial', now).intervalDays, 3);
    assert.equal(reviewSchedule(7, 'remembered', now).intervalDays, 14);
    await act(async () => { renderer.unmount(); });
});
