// Seeds the bakery schedule, a demo catalog, and the administrator. Safe to re-run:
// - opening days are upserted and closures are added if missing;
// - products are inserted only when the products table is empty, so admin edits survive;
// - the administrator is upserted by email, so re-running resets its password.
//
// Run with Node's built-in TypeScript support, so imports use explicit `.ts` paths and no aliases.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hashPassword } from '../src/server/auth/password.ts';
import {
    adminUsers,
    bakeryClosures,
    bakeryOpeningDays,
    productWeekdays,
    products,
} from '../src/server/db/schema.ts';

const MIN_ADMIN_PASSWORD_LENGTH = 12;

// 0 = Sunday … 6 = Saturday. Closed on Mondays.
const OPENING_DAYS = [
    { weekday: 0, isOpen: true },
    { weekday: 1, isOpen: false },
    { weekday: 2, isOpen: true },
    { weekday: 3, isOpen: true },
    { weekday: 4, isOpen: true },
    { weekday: 5, isOpen: true },
    { weekday: 6, isOpen: true },
];

const CLOSURES = [
    { date: '2026-12-24', reason: 'Christmas Eve' },
    { date: '2026-12-25', reason: 'Christmas Day' },
    { date: '2026-12-26', reason: "St. Stephen's Day" },
    { date: '2027-01-01', reason: "New Year's Day" },
];

type SeedProduct = typeof products.$inferInsert & { weekdays: number[] };

// Prices in haléře. An empty weekday list means the product is offered on every open day.
const PRODUCTS: SeedProduct[] = [
    {
        name: 'Sourdough country loaf',
        description: 'Naturally leavened wheat and rye loaf with a crackling crust. 900 g.',
        price: 8900,
        defaultCapacity: 30,
        defaultWalkInQuantity: 10,
        weekdays: [],
    },
    {
        name: 'Rye bread with caraway',
        description: 'Traditional Czech rye bread with caraway seeds. 1 kg.',
        price: 6500,
        defaultCapacity: 25,
        defaultWalkInQuantity: 8,
        weekdays: [],
    },
    {
        name: 'Baguette',
        description: 'Long-fermented French baguette.',
        price: 4200,
        defaultCapacity: 50,
        defaultWalkInQuantity: 20,
        weekdays: [],
    },
    {
        name: 'Butter croissant',
        description: 'Laminated with French butter, baked every morning.',
        price: 3900,
        defaultCapacity: 60,
        defaultWalkInQuantity: 25,
        weekdays: [],
    },
    {
        name: 'Cinnamon roll',
        description: 'Soft brioche swirl with cinnamon and brown sugar.',
        price: 4500,
        defaultCapacity: 40,
        defaultWalkInQuantity: 15,
        weekdays: [],
    },
    {
        name: 'Poppy seed kolach',
        description: 'Round Czech pastry filled with sweet poppy seeds. Weekends only.',
        price: 3500,
        defaultCapacity: 40,
        defaultWalkInQuantity: 15,
        weekdays: [5, 6, 0],
    },
    {
        name: 'Braided vánočka',
        description: 'Festive braided sweet bread with raisins and almonds. Fridays and Saturdays.',
        price: 18900,
        defaultCapacity: 12,
        defaultWalkInQuantity: 2,
        weekdays: [5, 6],
    },
];

const requireEnv = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} must be set`);
    }
    return value;
};

const seed = async (): Promise<void> => {
    const connectionString = process.env.DATABASE_URL_UNPOOLED || requireEnv('DATABASE_URL');
    const adminEmail = requireEnv('ADMIN_SEED_EMAIL').toLowerCase();
    const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? '';
    if (adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
        throw new Error(
            `ADMIN_SEED_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
        );
    }
    const passwordHash = await hashPassword(adminPassword);

    const pool = new Pool({ connectionString, max: 1 });
    try {
        const db = drizzle(pool);
        await db.transaction(async (tx) => {
            await tx
                .insert(bakeryOpeningDays)
                .values(OPENING_DAYS)
                .onConflictDoUpdate({
                    target: bakeryOpeningDays.weekday,
                    set: { isOpen: sql`excluded.is_open` },
                });

            await tx.insert(bakeryClosures).values(CLOSURES).onConflictDoNothing();

            const existingProducts = await tx.select({ id: products.id }).from(products).limit(1);
            if (existingProducts.length === 0) {
                for (const { weekdays, ...product } of PRODUCTS) {
                    const [inserted] = await tx
                        .insert(products)
                        .values(product)
                        .returning({ id: products.id });
                    if (weekdays.length > 0) {
                        await tx
                            .insert(productWeekdays)
                            .values(
                                weekdays.map((weekday) => ({ productId: inserted.id, weekday })),
                            );
                    }
                }
                console.log(`Inserted ${PRODUCTS.length} products.`);
            } else {
                console.log('Products already exist; catalog left unchanged.');
            }

            await tx
                .insert(adminUsers)
                .values({ email: adminEmail, passwordHash })
                .onConflictDoUpdate({ target: adminUsers.email, set: { passwordHash } });
        });
        console.log(`Seeded schedule and administrator ${adminEmail}.`);
    } finally {
        await pool.end();
    }
};

await seed();
