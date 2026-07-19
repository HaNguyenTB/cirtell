import { expect, type Page, test } from '@playwright/test';
import { createMockState, installMockApi, installMockAuth, type MockState, type MockUserOptions } from './fixtures/mockApi';

interface TransactionCreateRequest {
  movement_type: string;
  market_id: string;
  quantity: number;
  unit_price_usd: number;
  items: Array<{
    part_id?: string;
    quantity: number;
    unit_price_usd: number;
    destination_warehouse_id?: string;
  }>;
}

async function setupApp(page: Page, actor: MockUserOptions = { role: 'Admin', isSuperAdmin: true }) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  const state = createMockState();
  await installMockAuth(page, actor);
  await installMockApi(page, state, actor);
  return { state, pageErrors };
}

async function expectNoPageErrors(pageErrors: string[]) {
  expect(pageErrors).toEqual([]);
}

async function openTransactionModal(page: Page) {
  await page.getByRole('button', { name: /Add Transaction/i }).click();
  const modal = page.locator('div.fixed.inset-0.z-50').filter({ hasText: 'Add Transaction' });
  await expect(modal).toBeVisible();
  return modal;
}

async function createPurchaseWithPo(page: Page, state: MockState) {
  const modal = await openTransactionModal(page);
  await modal.getByRole('combobox').selectOption('market-qa');
  await modal.getByRole('button', { name: /Next/i }).click();

  await modal.getByRole('button', { name: 'Multi-Item' }).click();
  await modal.getByRole('button', { name: 'Manual' }).click();
  await modal.getByPlaceholder('Search or enter new part number...').fill('ANT');
  await modal.getByRole('button', { name: /ANT-001/ }).click();
  await modal.getByPlaceholder('Qty').fill('3');
  await modal.getByPlaceholder('Unit $').fill('150');
  await modal.locator('select').last().selectOption('warehouse-main');
  await modal.getByRole('button', { name: /Next/i }).click();

  await modal.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample-po.pdf');
  await expect(modal.getByText('sample-po.pdf')).toBeVisible();
  await modal.getByRole('button', { name: /Submit Transaction/i }).click();

  await expect.poll(() => state.requests.transactionCreates.length).toBe(1);
  await expect.poll(() => state.requests.poUploads.length).toBe(1);
}

test('admin can enter dashboard and navigate core modules', async ({ page }) => {
  const { pageErrors } = await setupApp(page, { role: 'Admin', isSuperAdmin: true });
  const projectChildDeletes: string[] = [];
  const projectDetailLoads: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'DELETE' && /^\/api\/projects\/project-1\/(equipment|financials)\//.test(path)) {
      projectChildDeletes.push(path);
    }
    if (request.method() === 'GET' && path === '/api/projects/project-1') {
      projectDetailLoads.push(path);
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Total Transactions')).toBeVisible();
  await expect(page.getByText('Actual CO2e')).toBeVisible();
  await expect(page.getByText('Avoided CO2e')).toBeVisible();
  await expect(page.getByText('Parts in Catalog')).toBeVisible();

  await page.getByRole('link', { name: /Parts Catalog/i }).click();
  await expect(page).toHaveURL(/\/parts$/);
  await expect(page.getByRole('heading', { name: 'Parts Catalogue' })).toBeVisible();

  await page.getByRole('link', { name: /Transactions/i }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole('heading', { name: 'Transaction History' })).toBeVisible();

  await page.getByRole('link', { name: /Warehouse/i }).click();
  await expect(page).toHaveURL(/\/warehouse$/);
  await expect(page.getByRole('heading', { name: 'Stock & Warehouses' })).toBeVisible();

  await page.getByRole('link', { name: /Carbon/i }).click();
  await expect(page).toHaveURL(/\/carbon$/);
  await expect(page.getByRole('heading', { name: 'Carbon Accounting' })).toBeVisible();

  await page.getByRole('link', { name: /Projects/i }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByRole('button', { name: /BTS Circularity Pilot/i }).click();
  await expect(page).toHaveURL(/\/projects\/project-1$/);
  await expect(page.getByRole('heading', { name: 'BTS Circularity Pilot' })).toBeVisible();

  const materialsKpi = page.getByText('Materials', { exact: true }).locator('..');
  await expect(materialsKpi).toContainText('2');
  await expect(page.getByText('6.8 kg', { exact: true })).toBeVisible();
  await expect(page.getByText('$5,000', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Materials & Assets' }).click();
  const projectedMaterialRow = page.getByRole('row').filter({ hasText: 'Remote Radio Unit' });
  const manualMaterialRow = page.getByRole('row').filter({ hasText: 'Site survey and RF test kit' });
  await expect(projectedMaterialRow).toContainText('Matched');
  await expect(projectedMaterialRow.getByTitle('Delete project equipment')).toHaveCount(0);
  await expect(projectedMaterialRow.getByTitle('Open source transaction')).toHaveCount(1);
  await expect(manualMaterialRow).toContainText('Manual');
  await expect(manualMaterialRow.getByTitle('Delete project equipment')).toHaveCount(1);

  await projectedMaterialRow.getByTitle('Open source transaction').click();
  await expect(page).toHaveURL(/\/transactions\?transaction_id=transaction-redeploy-1$/);
  await expect(page.getByText('Transaction opened from Project')).toBeVisible();
  await expect(page.getByText('Remote Radio Unit', { exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/project-1$/);
  await expect(page.getByRole('heading', { name: 'BTS Circularity Pilot' })).toBeVisible();
  await expect.poll(() => projectDetailLoads.length).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Financials' }).click();
  await expect(page.getByText('$4,400', { exact: true })).toBeVisible();
  const projectedFinancialRow = page.getByRole('row').filter({ hasText: 'Redeployment value' });
  const manualFinancialRow = page.getByRole('row').filter({ hasText: 'Refurbishment' });
  await expect(projectedFinancialRow).toContainText('Matched');
  await expect(projectedFinancialRow.getByTitle('Open source transaction')).toHaveCount(1);
  await expect(projectedFinancialRow.getByRole('button')).toHaveCount(1);
  await expect(manualFinancialRow).toContainText('Manual');
  await expect(manualFinancialRow.getByTitle('Open source transaction')).toHaveCount(0);
  await expect(manualFinancialRow.getByRole('button')).toHaveCount(1);
  expect(projectChildDeletes).toEqual([]);

  await expectNoPageErrors(pageErrors);
});

test('admin can create a scoped part', async ({ page }) => {
  const { state, pageErrors } = await setupApp(page, { role: 'Admin', isSuperAdmin: true });

  await page.goto('/parts');
  await page.getByPlaceholder('Search parts...').fill('ANT-001');
  await expect(page.getByText('ANT-001', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: /Add Part/i }).click();
  const modal = page.locator('.modal-panel').filter({ hasText: 'New Part' });
  await expect(modal).toBeVisible();
  await modal.getByRole('textbox').nth(0).fill('OPT-777');
  await modal.getByRole('textbox').nth(2).fill('Optical Module 777');
  await modal.getByRole('textbox').nth(3).fill('Cisco');
  await modal.getByRole('textbox').nth(4).fill('5G');
  await modal.getByRole('textbox').nth(5).fill('Optical');
  await modal.getByRole('textbox').nth(6).fill('Transport');
  await modal.getByRole('spinbutton').nth(0).fill('1.5');
  await modal.getByRole('spinbutton').nth(1).fill('0.8');
  await modal.getByRole('button', { name: 'Create' }).click();

  await expect.poll(() => state.requests.partCreates.length).toBe(1);
  expect(state.requests.partCreates[0]).toMatchObject({
    part_number: 'OPT-777',
    model_name: 'Optical Module 777',
    vendor: 'Cisco',
    category: 'Optical',
    subcategory: 'Transport',
    weight_kg: 1.5,
    emission_factor_kg: 0.8,
  });

  await page.getByPlaceholder('Search parts...').fill('OPT-777');
  await expect(page.getByText('OPT-777')).toBeVisible();
  await expect(page.getByText('Optical Module 777')).toBeVisible();
  await expectNoPageErrors(pageErrors);
});

test('user can create a transaction and upload a purchase order', async ({ page }) => {
  const { state, pageErrors } = await setupApp(page, { role: 'User', isSuperAdmin: false });

  await page.goto('/transactions');
  await createPurchaseWithPo(page, state);

  const transactionBody = state.requests.transactionCreates[0] as TransactionCreateRequest;
  expect(transactionBody).toMatchObject({
    movement_type: 'Purchase',
    market_id: 'market-qa',
    quantity: 3,
    unit_price_usd: 150,
  });
  expect(transactionBody.items).toHaveLength(1);
  expect(transactionBody.items[0]).toMatchObject({
    part_id: 'part-antenna',
    quantity: 3,
    unit_price_usd: 150,
    destination_warehouse_id: 'warehouse-main',
  });
  expect(state.requests.poUploads[0]).toMatchObject({
    fileName: 'sample-po.pdf',
    contentType: 'application/pdf',
  });

  await expect(page.getByText('$450.00', { exact: true })).toBeVisible();
  await expectNoPageErrors(pageErrors);
});

test('inventory and carbon workflows respect viewer permissions', async ({ browser }) => {
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  const userSetup = await setupApp(userPage, { role: 'User', isSuperAdmin: false });

  await userPage.goto('/warehouse');
  await userPage.getByText('Main Warehouse').first().click();
  await userPage.getByRole('button', { name: /Add Stock/i }).click();
  const moveForm = userPage.locator('form').filter({ hasText: 'Part Number *' });
  await moveForm.getByPlaceholder('Search by part number or model...').fill('ANT');
  await moveForm.getByRole('button', { name: /ANT-001/ }).click({ force: true });
  await moveForm.getByRole('spinbutton').fill('5');
  await moveForm.getByRole('button', { name: /Submit Movement/i }).click();

  await expect.poll(() => userSetup.state.requests.inventoryMoves.length).toBe(1);
  expect(userSetup.state.requests.inventoryMoves[0]).toMatchObject({
    movement_type: 'Receive',
    part_id: 'part-antenna',
    quantity: 5,
    to_warehouse_id: 'warehouse-main',
  });
  await expect(userPage.getByRole('cell', { name: '5', exact: true }).first()).toBeVisible();

  await userPage.getByRole('link', { name: /Carbon/i }).click();
  await userPage.getByRole('button', { name: /Add Entry/i }).click();
  const carbonModal = userPage.locator('.modal-panel').filter({ hasText: 'New Emission Entry' });
  await carbonModal.getByRole('combobox').first().selectOption('1');
  await carbonModal.getByPlaceholder(/Natural gas combustion/).fill('Grid electricity E2E');
  await carbonModal.locator('input[type="number"]').nth(0).fill('10');
  await carbonModal.getByPlaceholder(/kWh|km|kg/).fill('kWh');
  await carbonModal.locator('input[type="number"]').nth(1).fill('2.5');
  await carbonModal.locator('input[type="date"]').nth(0).fill('2026-06-01');
  await carbonModal.locator('input[type="date"]').nth(1).fill('2026-06-30');
  await carbonModal.getByRole('button', { name: 'Create' }).click();

  await expect.poll(() => userSetup.state.requests.ghgCreates.length).toBe(1);
  expect(userSetup.state.requests.ghgCreates[0]).toMatchObject({
    scope: 1,
    source_description: 'Grid electricity E2E',
    activity_data: 10,
    emission_factor: 2.5,
  });
  await expect(userPage.getByText('Grid electricity E2E')).toBeVisible();
  await expect(userPage.getByRole('row', { name: /Grid electricity E2E.*25/ })).toBeVisible();
  await expectNoPageErrors(userSetup.pageErrors);
  await userContext.close();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  const viewerSetup = await setupApp(viewerPage, { role: 'Viewer', isSuperAdmin: false });

  await viewerPage.goto('/parts');
  await expect(viewerPage.getByRole('heading', { name: 'Parts Catalogue' })).toBeVisible();
  await expect(viewerPage.getByRole('button', { name: /Add Part/i })).toHaveCount(0);
  await expect(viewerPage.getByRole('link', { name: /Administration/i })).toHaveCount(0);

  await viewerPage.getByRole('link', { name: /Transactions/i }).click();
  await expect(viewerPage.getByRole('button', { name: /Add Transaction/i })).toHaveCount(0);

  await viewerPage.getByRole('link', { name: /Warehouse/i }).click();
  await expect(viewerPage.getByRole('button', { name: /Add Warehouse/i })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: /Move Inventory/i })).toHaveCount(0);
  await expect(viewerPage.getByRole('button', { name: /Add Stock/i })).toHaveCount(0);

  await viewerPage.getByRole('link', { name: /Carbon/i }).click();
  await expect(viewerPage.getByRole('button', { name: /Add Entry/i })).toHaveCount(0);

  await expectNoPageErrors(viewerSetup.pageErrors);
  await viewerContext.close();
});
