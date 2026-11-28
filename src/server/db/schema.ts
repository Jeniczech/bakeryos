import { sql } from 'drizzle-orm';
import {
    boolean,
    check,
    date,
    index,
    integer,
    pgSequence,
    pgTable,
    primaryKey,
    smallint,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
    timestamp('updated_at', { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date());

export const adminUsers = pgTable('admin_users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
});

export const products = pgTable(
    'products',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        name: text('name').notNull(),
        description: text('description'),
        imageUrl: text('image_url'),
        price: integer('price').notNull(),
        active: boolean('active').notNull().default(true),
        defaultCapacity: integer('default_capacity').notNull(),
        defaultWalkInQuantity: integer('default_walk_in_quantity').notNull().default(0),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        uniqueIndex('products_name_unique').on(sql`lower(${table.name})`),
        check('products_name_not_blank', sql`length(trim(${table.name})) > 0`),
        check('products_price_nonnegative', sql`${table.price} >= 0`),
        check('products_default_capacity_nonnegative', sql`${table.defaultCapacity} >= 0`),
        check(
            'products_default_walk_in_within_capacity',
            sql`${table.defaultWalkInQuantity} >= 0 and ${table.defaultWalkInQuantity} <= ${table.defaultCapacity}`,
        ),
    ],
);

export const dailyProductPlans = pgTable(
    'daily_product_plans',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id),
        date: date('date', { mode: 'string' }).notNull(),
        capacity: integer('capacity').notNull(),
        walkInQuantity: integer('walk_in_quantity').notNull(),
        createdAt: createdAt(),
        updatedAt: updatedAt(),
    },
    (table) => [
        unique('daily_product_plans_product_date_unique').on(table.productId, table.date),
        check('daily_product_plans_capacity_nonnegative', sql`${table.capacity} >= 0`),
        check(
            'daily_product_plans_walk_in_within_capacity',
            sql`${table.walkInQuantity} >= 0 and ${table.walkInQuantity} <= ${table.capacity}`,
        ),
    ],
);

// MAXVALUE keeps every number within the six zero-padded digits: overflow fails loudly
// instead of lpad() silently truncating into a duplicate.
export const reservationNumberSeq = pgSequence('reservation_number_seq', {
    startWith: 1,
    maxValue: 999999,
});

export const reservationSources = ['online', 'admin'] as const;
export const reservationStatuses = ['confirmed', 'picked_up', 'cancelled', 'no_show'] as const;

export const reservations = pgTable(
    'reservations',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        reservationNumber: text('reservation_number')
            .notNull()
            .unique()
            .default(sql`('BK-' || lpad(nextval('reservation_number_seq')::text, 6, '0'))`),
        pickupDate: date('pickup_date', { mode: 'string' }).notNull(),
        customerName: text('customer_name').notNull(),
        customerPhone: text('customer_phone').notNull(),
        source: text('source', { enum: reservationSources }).notNull(),
        status: text('status', { enum: reservationStatuses }).notNull().default('confirmed'),
        retainForProduction: boolean('retain_for_production').notNull().default(false),
        managementTokenHash: text('management_token_hash').notNull().unique(),
        idempotencyKey: uuid('idempotency_key').notNull().unique(),
        requestHash: text('request_hash').notNull(),
        createdAt: createdAt(),
        cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    },
    (table) => [
        index('reservations_pickup_date_status_idx').on(table.pickupDate, table.status),
        check('reservations_source_valid', sql`${table.source} in ('online', 'admin')`),
        check(
            'reservations_status_valid',
            sql`${table.status} in ('confirmed', 'picked_up', 'cancelled', 'no_show')`,
        ),
        check(
            'reservations_cancelled_at_matches_status',
            sql`(${table.status} = 'cancelled') = (${table.cancelledAt} is not null)`,
        ),
        check(
            'reservations_retain_only_when_cancelled',
            sql`not ${table.retainForProduction} or ${table.status} = 'cancelled'`,
        ),
    ],
);

export const reservationItems = pgTable(
    'reservation_items',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        reservationId: uuid('reservation_id')
            .notNull()
            .references(() => reservations.id),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id),
        productNameSnapshot: text('product_name_snapshot').notNull(),
        unitPriceSnapshot: integer('unit_price_snapshot').notNull(),
        quantity: integer('quantity').notNull(),
    },
    (table) => [
        unique('reservation_items_reservation_product_unique').on(
            table.reservationId,
            table.productId,
        ),
        index('reservation_items_product_id_idx').on(table.productId),
        check('reservation_items_unit_price_nonnegative', sql`${table.unitPriceSnapshot} >= 0`),
        check('reservation_items_quantity_positive', sql`${table.quantity} > 0`),
    ],
);

// Weekdays use 0 = Sunday … 6 = Saturday, matching JavaScript getUTCDay() and PostgreSQL DOW.
export const bakeryOpeningDays = pgTable(
    'bakery_opening_days',
    {
        weekday: smallint('weekday').primaryKey(),
        isOpen: boolean('is_open').notNull(),
    },
    (table) => [check('bakery_opening_days_weekday_valid', sql`${table.weekday} between 0 and 6`)],
);

export const bakeryClosures = pgTable('bakery_closures', {
    date: date('date', { mode: 'string' }).primaryKey(),
    reason: text('reason'),
});

// A product without any rows here is offered on every open day.
export const productWeekdays = pgTable(
    'product_weekdays',
    {
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        weekday: smallint('weekday').notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.productId, table.weekday] }),
        check('product_weekdays_weekday_valid', sql`${table.weekday} between 0 and 6`),
    ],
);

export const rateLimits = pgTable(
    'rate_limits',
    {
        key: text('key').notNull(),
        windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
        count: integer('count').notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.key, table.windowStart] }),
        check('rate_limits_count_nonnegative', sql`${table.count} >= 0`),
    ],
);
