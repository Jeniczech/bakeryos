import { inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pragueTimeToInstant } from '@/lib/date-time/prague';
import { closeDb, getDb } from '@/server/db/client';
import { bakeryClosures, bakeryOpeningDays } from '@/server/db/schema';
import { getPickupDates } from '@/server/services/eligibility';

// Far outside any real booking window, and apart from other test files' dates: closures are
// global, and test files run in parallel.
const NOW = pragueTimeToInstant('2098-03-11', 12); // Tuesday noon
const WEDNESDAY = 3;
const CLOSED_WEDNESDAY = '2098-03-12';
const WEDNESDAY_AFTER_WINDOW = '2098-03-19';
const TEST_CLOSURES = [CLOSED_WEDNESDAY, WEDNESDAY_AFTER_WINDOW];

beforeAll(async () => {
    await getDb()
        .insert(bakeryOpeningDays)
        .values({ weekday: WEDNESDAY, isOpen: true })
        .onConflictDoNothing();
});

afterEach(async () => {
    await getDb().delete(bakeryClosures).where(inArray(bakeryClosures.date, TEST_CLOSURES));
});

afterAll(async () => {
    await closeDb();
});

describe('getPickupDates', () => {
    it('lists the booking window from tomorrow through today+7', async () => {
        const dates = await getPickupDates(NOW);

        expect(dates.map((option) => option.date)).toEqual([
            '2098-03-12',
            '2098-03-13',
            '2098-03-14',
            '2098-03-15',
            '2098-03-16',
            '2098-03-17',
            '2098-03-18',
        ]);
        expect(dates[0].unavailableReason).toBeNull();
    });

    it('marks a closure inside the window as closed', async () => {
        await getDb()
            .insert(bakeryClosures)
            .values(TEST_CLOSURES.map((date) => ({ date, reason: 'Pickup dates test' })));

        const dates = await getPickupDates(NOW);

        expect(dates[0]).toEqual({ date: CLOSED_WEDNESDAY, unavailableReason: 'BAKERY_CLOSED' });
        expect(dates.map((option) => option.date)).not.toContain(WEDNESDAY_AFTER_WINDOW);
    });
});
