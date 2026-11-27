import { expect, test, type Page } from '@playwright/test';

// Seeded products offered on every open day, so any bookable date lists them.
const SOURDOUGH = 'Kváskový chléb'; // 89 Kč
const BAGUETTE = 'Bageta'; // 42 Kč

const productCard = (page: Page, name: string) =>
    page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) });

/** The server's stored items: 2 × 89 Kč + 1 × 42 Kč. Prices use a non-breaking space. */
const expectReservedItems = async (page: Page) => {
    const items = page.getByRole('region', { name: 'Rezervované pečivo' });
    await expect(items.getByRole('listitem').filter({ hasText: SOURDOUGH })).toContainText(
        /2 × 89\sKč/,
    );
    await expect(items.getByRole('listitem').filter({ hasText: BAGUETTE })).toContainText(
        /1 × 42\sKč/,
    );
    await expect(items).toContainText(/Celkem\s*220\sKč/);
};

test('a customer books, opens the management link, and cancels', async ({ page }) => {
    await page.goto('/');

    // The first offered date: tomorrow before the cutoff, otherwise the next open day.
    await page
        .getByRole('navigation', { name: 'Den vyzvednutí' })
        .getByRole('link')
        .first()
        .click();
    await expect(page).toHaveURL(/\/den\/\d{4}-\d{2}-\d{2}$/);

    await productCard(page, SOURDOUGH).getByRole('button', { name: 'Přidat do košíku' }).click();
    await productCard(page, BAGUETTE).getByRole('button', { name: 'Přidat do košíku' }).click();
    const cart = page.getByRole('region', { name: 'Košík' });
    await cart.getByRole('button', { name: `Přidat 1 ks: ${SOURDOUGH}` }).click();
    await expect(cart).toContainText(/220\sKč/);

    await page.getByRole('textbox', { name: 'Jméno a příjmení' }).fill('Jana Nováková');
    await page.getByRole('textbox', { name: 'Telefon' }).fill('+420 777 123 456');
    await page.getByRole('button', { name: 'Odeslat rezervaci' }).click();

    await expect(page).toHaveURL(/\/potvrzeni$/);
    await expect(page.getByRole('heading', { name: 'Vaše rezervace je potvrzena!' })).toBeVisible();
    await expectReservedItems(page);

    await page
        .getByRole('region', { name: 'Odkaz na rezervaci' })
        .getByRole('link', { name: /\/reservations\/manage\// })
        .click();
    await expect(page).toHaveURL(/\/reservations\/manage\/[^/]+$/);
    await expect(page.getByRole('heading', { name: 'Vaše rezervace', level: 1 })).toBeVisible();
    await expectReservedItems(page);

    await page.getByRole('button', { name: 'Zrušit rezervaci' }).click();
    await page.getByRole('button', { name: 'Ano, zrušit rezervaci' }).click();
    await expect(page.getByRole('heading', { name: 'Rezervace je zrušená' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zrušit rezervaci' })).toHaveCount(0);

    // Reloaded from the server, so the cancellation is stored, not just shown.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Rezervace je zrušená' })).toBeVisible();
});
