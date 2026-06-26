import { expect, test } from '@playwright/test';
import { createMockState, installMockApi, installMockAuth } from './mockCirtellApi';

test.beforeEach(async ({ page }) => {
  await installMockAuth(page, { role: 'Admin', isSuperAdmin: true });
  await installMockApi(page, createMockState());
});

test('admin can open dashboard and navigate primary modules with mocked auth', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Total Transactions')).toBeVisible();

  await page.getByRole('link', { name: /Parts Catalog/i }).click();
  await expect(page.getByRole('heading', { name: 'Parts Catalogue' })).toBeVisible();
  await expect(page.getByText('ANT-001', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: /Transactions/i }).click();
  await expect(page.getByRole('heading', { name: 'Transaction History' })).toBeVisible();
  await expect(page.getByText('PO-2026-001')).toBeVisible();

  await page.getByRole('link', { name: /Warehouse/i }).click();
  await expect(page.getByRole('heading', { name: 'Stock & Warehouses' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Main Warehouse' })).toBeVisible();

  await page.getByRole('link', { name: /Carbon/i }).click();
  await expect(page.getByRole('heading', { name: 'Carbon Accounting' })).toBeVisible();
  await expect(page.getByText('Purchased telecom equipment')).toBeVisible();

  await page.getByRole('link', { name: /Projects/i }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('BTS Circularity Pilot')).toBeVisible();

  await page.getByRole('link', { name: /Administration/i }).click();
  await expect(page.getByRole('heading', { name: /Administration|Overview/i })).toBeVisible();

  await page.screenshot({ path: 'test-results/e2e/dashboard-smoke.png', fullPage: true });
});

test('parts search and create flow updates the catalog', async ({ page }) => {
  await page.goto('/parts');

  await page.getByPlaceholder('Search parts...').fill('ANT-001');
  await expect(page.getByText('ANT-001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('RRU-900')).toHaveCount(0);

  await page.getByRole('button', { name: /Add Part/i }).click();
  const modal = page.locator('.modal-panel').filter({ hasText: 'New Part' });
  await expect(modal).toBeVisible();
  await modal.getByRole('textbox').nth(0).fill('OPT-777');
  await modal.getByRole('textbox').nth(2).fill('Optical Module 777');
  await modal.getByRole('textbox').nth(3).fill('Cisco');
  await modal.getByRole('textbox').nth(4).fill('Optical');
  await modal.getByRole('textbox').nth(5).fill('Transport');
  await modal.getByRole('spinbutton').nth(0).fill('1.5');
  await modal.getByRole('spinbutton').nth(1).fill('0.8');
  await modal.getByRole('button', { name: 'Create' }).click();

  await page.getByPlaceholder('Search parts...').fill('OPT-777');
  await expect(page.getByText('OPT-777')).toBeVisible();
  await expect(page.getByText('Optical Module 777')).toBeVisible();
});

test('transaction, inventory receive, and carbon entry flows submit through mocked APIs', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /Add Transaction/i }).click();
  const transactionModal = page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Add Transaction' });
  await expect(transactionModal).toBeVisible();
  await transactionModal.getByRole('combobox').selectOption('market-qa');
  await transactionModal.getByRole('button', { name: /Next/i }).click();
  await transactionModal.getByPlaceholder('Search or enter new part number...').fill('ANT');
  await transactionModal.getByRole('button', { name: /ANT-001/ }).click();
  await transactionModal.getByLabel('Quantity *').fill('3');
  await transactionModal.getByLabel('Unit Price (USD)').fill('150');
  await transactionModal.getByLabel('Condition').selectOption('NIB');
  await transactionModal.getByRole('button', { name: /Next/i }).click();
  await transactionModal.getByRole('combobox').nth(1).selectOption('warehouse-main');
  await transactionModal.getByRole('button', { name: /Submit Transaction/i }).click();
  await expect(page.getByText('$450.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '3', exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Warehouse/i }).click();
  await page.getByText('Main Warehouse').first().click();
  await page.getByRole('button', { name: /Add Stock/i }).click();
  const moveForm = page.locator('form').filter({ hasText: 'Part Number *' });
  await moveForm.getByPlaceholder('Search by part number or model...').fill('ANT');
  await moveForm.getByRole('button', { name: /ANT-001/ }).click({ force: true });
  await moveForm.getByRole('spinbutton').fill('5');
  await moveForm.getByRole('button', { name: /Submit Movement/i }).click();
  await expect(page.getByText('Recent Warehouse Movements')).toBeVisible();
  await expect(page.getByRole('cell', { name: '5', exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: /Carbon/i }).click();
  await page.getByRole('button', { name: /Add Entry/i }).click();
  const carbonModal = page.locator('.modal-panel').filter({ hasText: 'New Emission Entry' });
  await carbonModal.getByRole('combobox').first().selectOption('1');
  await carbonModal.getByPlaceholder(/Natural gas combustion/).fill('Grid electricity smoke test');
  await carbonModal.locator('input[type="number"]').nth(0).fill('100');
  await carbonModal.getByPlaceholder(/kWh|km|kg/).fill('kWh');
  await carbonModal.locator('input[type="number"]').nth(1).fill('2.5');
  await carbonModal.locator('input[type="date"]').nth(0).fill('2026-06-01');
  await carbonModal.locator('input[type="date"]').nth(1).fill('2026-06-30');
  await carbonModal.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Grid electricity smoke test')).toBeVisible();
  await expect(page.getByRole('cell', { name: '250', exact: true })).toBeVisible();
});

test('viewer session hides write and administration controls', async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await installMockAuth(page, { role: 'Viewer', isSuperAdmin: false });
  await installMockApi(page, createMockState());

  await page.goto('/parts');
  await expect(page.getByRole('heading', { name: 'Parts Catalogue' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add Part/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Administration/i })).toHaveCount(0);

  await page.getByRole('link', { name: /Transactions/i }).click();
  await expect(page.getByRole('button', { name: /Add Transaction/i })).toHaveCount(0);

  await page.getByRole('link', { name: /Warehouse/i }).click();
  await expect(page.getByRole('button', { name: /Add Warehouse/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Move Inventory/i })).toHaveCount(0);

  await page.getByRole('link', { name: /Carbon/i }).click();
  await expect(page.getByRole('button', { name: /Add Entry/i })).toHaveCount(0);

  await page.getByRole('link', { name: /Projects/i }).click();
  await expect(page.getByRole('button', { name: /New Project/i })).toHaveCount(0);
});
