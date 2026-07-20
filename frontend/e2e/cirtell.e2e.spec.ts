import { expect, type Page, test } from '@playwright/test';
import { createMockState, installMockApi, installMockAuth, type MockState, type MockUserOptions } from './fixtures/mockApi';

interface TransactionCreateRequest {
  movement_type: string;
  market_id: string;
  contact_id: string;
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

  await modal.getByLabel('Buyer / Contact').selectOption('contact-buyer');
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
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  await expect(page.getByText('Synced').first()).toBeVisible();
  await expect(page.getByTitle('Void transaction').first()).toBeVisible();

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
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Project performance report' })).toBeVisible();
  await expect(page.getByText('Assets by lifecycle stage')).toBeVisible();
  await expect(page.getByText('Condition mix')).toBeVisible();
  await expect(page.getByText('Financial composition')).toBeVisible();
  await expect(page.getByText('Workflow completion')).toBeVisible();
  await expect(page.getByText('Impact by equipment category')).toBeVisible();
  await expect(page.locator('.recharts-responsive-container')).toHaveCount(5);
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

  await expect(modal).toBeHidden();
  await page.getByPlaceholder('Search parts...').fill('OPT-777');
  const createdPartRow = page.getByRole('row').filter({ hasText: 'OPT-777' });
  await expect(createdPartRow).toBeVisible();
  await expect(createdPartRow).toContainText('Optical Module 777');
  await expectNoPageErrors(pageErrors);
});

test('user can create a transaction and upload a purchase order', async ({ page }) => {
  const { state, pageErrors } = await setupApp(page, { role: 'User', isSuperAdmin: false });
  const poDownloads: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/transactions\/[^/]+\/po-download$/.test(new URL(request.url()).pathname)) {
      poDownloads.push(request.url());
    }
  });

  await page.goto('/transactions');
  await createPurchaseWithPo(page, state);

  const transactionBody = state.requests.transactionCreates[0] as TransactionCreateRequest;
  expect(transactionBody).toMatchObject({
    movement_type: 'Purchase',
    market_id: 'market-qa',
    contact_id: 'contact-buyer',
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
  const createdRow = page.getByRole('row').filter({ hasText: '$450.00' });
  await expect(createdRow).toContainText('PO: sample-po.pdf');
  await expect(createdRow.getByRole('button', { name: /View/i })).toHaveCount(0);

  await createdRow.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => poDownloads.length).toBe(1);
  await expect(createdRow.getByTitle('Replace PO')).toBeVisible();
  await expect(createdRow.getByTitle('Delete PO')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await createdRow.getByTitle('Delete PO').click();
  await expect.poll(() => state.requests.poDeletes.length).toBe(1);
  await expect(createdRow).not.toContainText('sample-po.pdf');
  await expect(createdRow.getByTitle('Upload PO')).toBeVisible();
  await expectNoPageErrors(pageErrors);
});

test('inventory and carbon workflows respect viewer permissions', async ({ browser }) => {
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  const userSetup = await setupApp(userPage, { role: 'User', isSuperAdmin: false });
  userSetup.state.movements.push(...Array.from({ length: 10 }, (_, index) => ({
    id: `manual-movement-${index + 1}`,
    movement_type: 'Receive',
    from_warehouse_id: null,
    to_warehouse_id: 'warehouse-main',
    part_number: 'ANT-001',
    model_name: '5G Panel Antenna',
    quantity: index + 1,
    condition: 'NIB',
    from_warehouse_name: null,
    from_zone_name: null,
    to_warehouse_name: 'Main Warehouse',
    to_zone_name: 'Receiving',
    reference: null,
    notes: null,
    created_by_name: 'User Actor',
    created_at: `2026-06-${String(13 + index).padStart(2, '0')}T08:00:00Z`,
    transaction_id: null,
    transaction_date: null,
    transaction_movement_type: null,
    transaction_po_number: null,
  })));

  await userPage.goto('/warehouse');
  await expect(userPage.getByRole('table', { name: 'Recent Movements' }).getByRole('row')).toHaveCount(9);
  await userPage.getByText('Main Warehouse').first().click();
  await expect(userPage.getByRole('heading', { name: 'Warehouse Movement History' })).toBeVisible();
  await expect(userPage.getByRole('table', { name: 'Warehouse Movement History' }).getByRole('row')).toHaveCount(12);
  await expect(userPage.getByRole('table', { name: 'Warehouse Movement History' }).getByRole('link', { name: /Purchase/ })).toBeVisible();
  await expect(userPage.getByRole('heading', { name: 'Warehouse Zones' })).toBeVisible();
  await expect(userPage.getByText('Receiving', { exact: true })).toBeVisible();
  await userPage.getByRole('button', { name: 'Add Zone', exact: true }).first().click();
  const zoneForm = userPage.locator('form').filter({ hasText: 'Zone Name *' });
  await zoneForm.getByPlaceholder('e.g., Storage A').fill('Inspection B');
  await zoneForm.getByRole('combobox').selectOption('inspection');
  await zoneForm.getByPlaceholder('Optional').fill('40');
  await zoneForm.getByRole('button', { name: 'Create Zone' }).click();
  await expect.poll(() => userSetup.state.requests.zoneCreates.length).toBe(1);
  await expect(userPage.getByText('Inspection B', { exact: true })).toBeVisible();

  await userPage.getByRole('button', { name: /Add Stock/i }).click();
  const moveForm = userPage.locator('form').filter({ hasText: 'Part Number *' });
  await moveForm.getByPlaceholder('Search by part number or model...').fill('ANT');
  await moveForm.getByRole('button', { name: /ANT-001/ }).click({ force: true });
  await moveForm.getByRole('spinbutton').fill('5');
  await moveForm.locator('select').last().selectOption('zone-4');
  await moveForm.getByRole('button', { name: /Submit Movement/i }).click();

  await expect.poll(() => userSetup.state.requests.inventoryMoves.length).toBe(1);
  expect(userSetup.state.requests.inventoryMoves[0]).toMatchObject({
    movement_type: 'Receive',
    part_id: 'part-antenna',
    quantity: 5,
    to_warehouse_id: 'warehouse-main',
    to_zone_id: 'zone-4',
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
  const createdEntry = userSetup.state.ghgEntries.find((entry) => entry.source_description === 'Grid electricity E2E');
  expect(createdEntry).toBeDefined();

  await userPage.getByRole('button', { name: 'Delete Grid electricity E2E' }).click();
  const deleteDialog = userPage.getByRole('dialog', { name: 'Delete emission entry?' });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText('Grid electricity E2E');
  await expect(deleteDialog).toContainText('25 kg CO2e');
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(deleteDialog).not.toBeVisible();

  await userPage.getByRole('button', { name: 'Delete Grid electricity E2E' }).click();
  await deleteDialog.getByRole('button', { name: 'Delete entry' }).click();
  await expect.poll(() => userSetup.state.requests.ghgDeletes).toEqual([createdEntry!.id]);
  await expect(userPage.getByText('Grid electricity E2E')).toHaveCount(0);
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
