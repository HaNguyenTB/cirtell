import type { Page, Request, Route } from '@playwright/test';

export type UserRole = 'Admin' | 'User' | 'Viewer';

export interface MockUserOptions {
  role?: UserRole;
  isSuperAdmin?: boolean;
}

interface MockPart {
  id: string;
  part_number: string;
  manufacturer_part_number: string | null;
  model_name: string | null;
  vendor: string | null;
  technology_type: string | null;
  weight_kg: number | null;
  emission_factor_kg: number | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  needs_review?: boolean;
  review_notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface MockTransaction {
  id: string;
  date: string;
  marketId: string | null;
  marketName: string | null;
  region: string | null;
  movementType: 'Purchase' | 'Sale' | 'Redeploy' | 'Recycle';
  quantity: number;
  unitPrice: number;
  totalValue: number;
  vendor: string | null;
  partId: string | null;
  partNumber: string | null;
  partName: string | null;
  technology: string | null;
  category: string | null;
  condition: string | null;
  poNumber: string | null;
  projectId: string | null;
  projectName: string | null;
  destinationWarehouseId: string | null;
  destinationWarehouseName: string | null;
  destinationWarehouseCode: string | null;
  itemCount: number;
}

interface MockWarehouse {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  capacity_units: number;
  status: string;
  notes?: string | null;
  zone_count?: number;
  total_units?: number;
}

interface MockInventoryItem {
  id: string;
  warehouse_id?: string;
  warehouse_name: string;
  warehouse_code: string;
  part_id: string;
  part_number: string;
  model_name: string | null;
  category: string | null;
  condition: string;
  quantity: number;
}

interface MockMovement {
  id: string;
  movement_type: string;
  part_number: string;
  quantity: number;
  condition: string;
  from_warehouse_name: string | null;
  to_warehouse_name: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

interface MockProject {
  id: string;
  name: string;
  status: string;
  operator: string | null;
  region: string | null;
  country: string | null;
  site_name: string | null;
  internal_reference: string | null;
  equipment_count: number;
  co2_avoided_kg: number;
  reuse_value: number;
  vendor_names: string | null;
  technology_names: string | null;
  created_at: string;
}

interface MockGhgEntry {
  id: string;
  source_type?: 'manual' | 'transaction' | 'warehouse' | 'project';
  scope: number;
  category_id: number | null;
  scope3_stream: string | null;
  source_description: string;
  activity_data: number;
  activity_unit: string;
  emission_factor: number;
  emission_factor_unit: string;
  co2e_kg: number;
  reporting_period_start: string;
  reporting_period_end: string;
  data_quality: string;
  created_by_name: string | null;
}

export interface MockState {
  parts: MockPart[];
  transactions: MockTransaction[];
  warehouses: MockWarehouse[];
  inventory: MockInventoryItem[];
  movements: MockMovement[];
  projects: MockProject[];
  ghgEntries: MockGhgEntry[];
  requests: {
    authValidate: unknown[];
    partCreates: unknown[];
    transactionCreates: unknown[];
    poUploads: Array<{ url: string; fileName: string | null; contentType: string | null }>;
    inventoryMoves: unknown[];
    ghgCreates: unknown[];
  };
}

const tenant = {
  id: 'tenant-a',
  name: 'TechBridge Telecom',
  domain: 'techbridge.example',
  parent_tenant_id: null,
  group_type: 'telco',
  is_platform_tenant: false,
};

const company = {
  id: 'company-a',
  tenant_id: tenant.id,
  code: 'TBVN',
  name: 'TechBridge Vietnam',
  logo_url: '',
};

const corsHeaders = {
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-credentials': 'true',
  vary: 'Origin',
};

function mockUser(role: UserRole, isSuperAdmin: boolean) {
  return {
    id: role === 'Viewer' ? 'user-viewer' : role === 'User' ? 'user-standard' : 'user-admin',
    email: role === 'Viewer'
      ? 'viewer@techbridge.example'
      : role === 'User'
        ? 'user@techbridge.example'
        : 'admin@techbridge.example',
    name: role === 'Viewer' ? 'Viewer User' : role === 'User' ? 'Standard User' : 'Admin User',
    role,
    status: 'active',
    tenant_id: tenant.id,
    company_id: company.id,
    tenant_name: tenant.name,
    company_name: company.name,
    is_super_admin: isSuperAdmin,
  };
}

function mockTenantContext(role: UserRole) {
  return {
    tenant,
    company_ids: [company.id],
    companies: [company],
    managed_tenants: role === 'Viewer' ? [] : [tenant],
  };
}

export function createMockState(): MockState {
  const parts: MockPart[] = [
    {
      id: 'part-antenna',
      part_number: 'ANT-001',
      manufacturer_part_number: 'MFR-ANT-001',
      model_name: '5G Panel Antenna',
      vendor: 'Nokia',
      technology_type: '5G',
      weight_kg: 12.5,
      emission_factor_kg: 2.1,
      category: 'Antenna',
      subcategory: 'RAN',
      description: 'Panel antenna for telecom reuse flows',
      needs_review: false,
      review_notes: null,
      created_at: '2026-06-01T08:00:00Z',
      updated_at: '2026-06-01T08:00:00Z',
    },
    {
      id: 'part-radio',
      part_number: 'RRU-900',
      manufacturer_part_number: 'MFR-RRU-900',
      model_name: 'Remote Radio Unit',
      vendor: 'Ericsson',
      technology_type: '4G',
      weight_kg: 18,
      emission_factor_kg: 3.4,
      category: 'Radio',
      subcategory: 'RAN',
      description: 'Radio unit tracked in the mock catalog',
      needs_review: false,
      review_notes: null,
      created_at: '2026-06-02T08:00:00Z',
      updated_at: '2026-06-02T08:00:00Z',
    },
  ];

  const warehouses: MockWarehouse[] = [
    {
      id: 'warehouse-main',
      code: 'WH-HN',
      name: 'Main Warehouse',
      city: 'Ha Noi',
      country: 'Vietnam',
      capacity_units: 500,
      status: 'active',
      notes: 'Primary mocked warehouse',
      zone_count: 2,
      total_units: 20,
    },
    {
      id: 'warehouse-reuse',
      code: 'WH-RU',
      name: 'Reuse Hub',
      city: 'Da Nang',
      country: 'Vietnam',
      capacity_units: 300,
      status: 'active',
      notes: 'Secondary mocked warehouse',
      zone_count: 1,
      total_units: 5,
    },
  ];

  const projects: MockProject[] = [
    {
      id: 'project-1',
      name: 'BTS Circularity Pilot',
      status: 'assessment',
      operator: 'TechBridge',
      region: 'North',
      country: 'Vietnam',
      site_name: 'HN-001',
      internal_reference: 'PRJ-2026-001',
      equipment_count: 3,
      co2_avoided_kg: 1250,
      reuse_value: 4200,
      vendor_names: 'Nokia',
      technology_names: '5G',
      created_at: '2026-06-10T08:00:00Z',
    },
  ];

  return {
    parts,
    warehouses,
    projects,
    inventory: [
      {
        id: 'inventory-1',
        warehouse_id: 'warehouse-main',
        warehouse_name: 'Main Warehouse',
        warehouse_code: 'WH-HN',
        part_id: 'part-antenna',
        part_number: 'ANT-001',
        model_name: '5G Panel Antenna',
        category: 'Antenna',
        condition: 'NIB',
        quantity: 20,
      },
    ],
    movements: [
      {
        id: 'movement-1',
        movement_type: 'Receive',
        part_number: 'ANT-001',
        quantity: 20,
        condition: 'NIB',
        from_warehouse_name: null,
        to_warehouse_name: 'Main Warehouse',
        reference: 'PO-2026-001',
        notes: 'Initial stock',
        created_at: '2026-06-12T08:00:00Z',
      },
    ],
    transactions: [
      {
        id: 'transaction-1',
        date: '2026-06-14',
        marketId: 'market-vn',
        marketName: 'Vietnam',
        region: 'APAC',
        movementType: 'Purchase',
        quantity: 2,
        unitPrice: 120,
        totalValue: 240,
        vendor: 'Nokia',
        partId: 'part-antenna',
        partNumber: 'ANT-001',
        partName: '5G Panel Antenna',
        technology: '5G',
        category: 'Antenna',
        condition: 'NIB',
        poNumber: 'PO-2026-001',
        projectId: 'project-1',
        projectName: 'BTS Circularity Pilot',
        destinationWarehouseId: 'warehouse-main',
        destinationWarehouseName: 'Main Warehouse',
        destinationWarehouseCode: 'WH-HN',
        itemCount: 1,
      },
      {
        id: 'transaction-redeploy-1',
        date: '2026-06-18',
        marketId: 'market-vn',
        marketName: 'Vietnam',
        region: 'APAC',
        movementType: 'Redeploy',
        quantity: 2,
        unitPrice: 2500,
        totalValue: 5000,
        vendor: 'Ericsson',
        partId: 'part-radio',
        partNumber: 'RRU-900',
        partName: 'Remote Radio Unit',
        technology: '4G',
        category: 'Radio',
        condition: 'Good',
        poNumber: null,
        projectId: 'project-1',
        projectName: 'BTS Circularity Pilot',
        destinationWarehouseId: 'warehouse-reuse',
        destinationWarehouseName: 'Reuse Hub',
        destinationWarehouseCode: 'WH-RU',
        itemCount: 0,
      },
    ],
    ghgEntries: [
      {
        id: 'ghg-avoided-1',
        source_type: 'transaction',
        scope: 3,
        category_id: 1,
        scope3_stream: 'Purchased goods and services',
        source_description: 'Avoided redeploy emissions',
        activity_data: 10,
        activity_unit: 'unit',
        emission_factor: 2.5,
        emission_factor_unit: 'kgCO2e',
        co2e_kg: 25,
        reporting_period_start: '2026-06-01',
        reporting_period_end: '2026-06-30',
        data_quality: 'estimated',
        created_by_name: 'System',
      },
      {
        id: 'ghg-1',
        scope: 3,
        category_id: 1,
        scope3_stream: 'Purchased goods and services',
        source_description: 'Purchased telecom equipment',
        activity_data: 20,
        activity_unit: 'unit',
        emission_factor: 2.5,
        emission_factor_unit: 'kgCO2e',
        co2e_kg: 50,
        reporting_period_start: '2026-06-01',
        reporting_period_end: '2026-06-30',
        data_quality: 'estimated',
        created_by_name: 'Admin User',
      },
    ],
    requests: {
      authValidate: [],
      partCreates: [],
      transactionCreates: [],
      poUploads: [],
      inventoryMoves: [],
      ghgCreates: [],
    },
  };
}

function mockProjectBundle(state: MockState) {
  const project = state.projects[0];
  return {
    project: {
      ...project,
      description: 'Pilot project for transaction-derived materials and financial reporting',
      currency: 'USD',
      timeframe_start: '2026-06-01',
      timeframe_end: '2026-08-31',
      updated_at: '2026-06-20T08:00:00Z',
    },
    vendors: [],
    technologies: [],
    stages: [
      { id: 'stage-assessment', project_id: project.id, stage: 'assessment', label: 'Assessment', status: 'completed', sort_order: 1 },
      { id: 'stage-redeployment', project_id: project.id, stage: 'redeployment', label: 'Redeployment', status: 'in_progress', sort_order: 2 },
    ],
    tasks: [],
    equipment: [
      {
        id: 'matched-radio-mirror',
        part_id: 'part-radio',
        item_name: 'Remote Radio Unit mirror',
        serial_number: null,
        vendor: 'Ericsson',
        category: 'Radio',
        quantity: 2,
        condition: 'Good',
        current_stage: 'redeployment',
        weight_kg: 18,
        estimated_reuse_value: 5000,
        co2_avoided_kg: 6.8,
      },
      {
        id: 'manual-project-kit',
        part_id: null,
        item_name: 'Site survey and RF test kit',
        asset_tag: 'KIT-001',
        serial_number: 'KIT-SERIAL',
        vendor: 'TechBridge',
        category: 'Project tooling',
        quantity: 1,
        condition: 'Good',
        current_stage: 'assessment',
        weight_kg: 12,
        estimated_reuse_value: 1500,
        co2_avoided_kg: 0,
      },
    ],
    financials: [
      {
        id: 'matched-redeployment-mirror',
        type: 'credit',
        category: 'Redeployment value',
        description: 'Manual mirror of redeployment value',
        amount: 5000,
        currency: 'USD',
        stage: 'redeployment',
        incurred_at: '2026-06-18',
      },
      {
        id: 'manual-refurb-cost',
        type: 'cost',
        category: 'Refurbishment',
        description: 'Testing and repair labor',
        amount: 600,
        currency: 'USD',
        stage: 'assessment',
        incurred_at: '2026-06-15',
      },
    ],
    logistics: [],
    evidence: [],
    comments: [],
    recentActivity: [],
    transactionProjection: {
      projectedEquipment: [
        {
          id: 'projection:' + project.id + ':part-radio:good:redeployment',
          projectId: project.id,
          partId: 'part-radio',
          partNumber: 'RRU-900',
          itemName: 'Remote Radio Unit',
          vendor: 'Ericsson',
          category: 'Radio',
          serialNumber: null,
          condition: 'Good',
          quantity: 2,
          currentStage: 'redeployment',
          weightKg: 18,
          estimatedReuseValue: 5000,
          transactionValue: 5000,
          co2AvoidedKg: 6.8,
          source: 'transaction',
          readOnly: true,
          transactionIds: ['transaction-redeploy-1'],
          inventorySyncStatuses: ['synced'],
        },
      ],
      projectedFinancials: [
        {
          id: 'transaction:transaction-redeploy-1',
          transactionId: 'transaction-redeploy-1',
          movementType: 'Redeploy',
          type: 'credit',
          category: 'Redeployment value',
          description: 'Redeployment transaction value',
          amount: 5000,
          currency: 'USD',
          stage: 'redeployment',
          incurredAt: '2026-06-18',
          source: 'transaction',
          readOnly: true,
        },
      ],
      matchedEquipmentProjectionIds: ['projection:project-1:part-radio:good:redeployment'],
      matchedFinancialTransactionIds: ['transaction-redeploy-1'],
      transactionSummary: {
        transactionCount: 1,
        lineCount: 1,
        totalTransactionValue: 5000,
        purchaseCost: 0,
        salesRevenue: 0,
        redeploymentCredit: 5000,
        recyclingRevenue: 0,
        projectedCo2AvoidedKg: 6.8,
      },
      reconciliationWarnings: [],
    },
    kpis: {
      equipment_count: 2,
      co2_avoided_kg: 6.8,
      reuse_value: 5000,
      revenue_credits: 5000,
      costs: 600,
      net_financial: 4400,
    },
  };
}
export async function installMockAuth(page: Page, options: MockUserOptions = {}) {
  const role = options.role ?? 'Admin';
  const isSuperAdmin = options.isSuperAdmin ?? role === 'Admin';
  await page.addInitScript(
    ({ role: injectedRole, isSuperAdmin: injectedSuperAdmin, tenantRecord, companyRecord }) => {
      const user = {
        id: injectedRole === 'Viewer' ? 'user-viewer' : injectedRole === 'User' ? 'user-standard' : 'user-admin',
        email: injectedRole === 'Viewer'
          ? 'viewer@techbridge.example'
          : injectedRole === 'User'
            ? 'user@techbridge.example'
            : 'admin@techbridge.example',
        name: injectedRole === 'Viewer' ? 'Viewer User' : injectedRole === 'User' ? 'Standard User' : 'Admin User',
        role: injectedRole,
        status: 'active',
        tenant_id: tenantRecord.id,
        company_id: companyRecord.id,
        tenant_name: tenantRecord.name,
        company_name: companyRecord.name,
        is_super_admin: injectedSuperAdmin,
      };
      const tenantContext = {
        tenant: tenantRecord,
        company_ids: [companyRecord.id],
        companies: [companyRecord],
        managed_tenants: injectedRole === 'Viewer' ? [] : [tenantRecord],
      };

      window.sessionStorage.setItem('cirtell_id_token', `mock-${injectedRole.toLowerCase()}-token`);
      window.sessionStorage.setItem(
        'cirtell-auth',
        JSON.stringify({
          state: {
            user,
            isAuthenticated: true,
            currentCompanyId: companyRecord.id,
            selectedTenantId: tenantRecord.id,
            tenantContext,
          },
          version: 0,
        }),
      );
    },
    { role, isSuperAdmin, tenantRecord: tenant, companyRecord: company },
  );
}

export async function installMockApi(page: Page, state = createMockState(), options: MockUserOptions = {}) {
  const role = options.role ?? 'Admin';
  const isSuperAdmin = options.isSuperAdmin ?? role === 'Admin';
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'https://accounts.google.com' && url.pathname === '/gsi/client') {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    await handleApiRoute(route, state, url, { role, isSuperAdmin });
  });
  return state;
}

async function handleApiRoute(route: Route, state: MockState, url: URL, actor: Required<MockUserOptions>) {
  const request = route.request();
  const method = request.method();
  const path = url.pathname;

  if (method === 'OPTIONS') {
    await respond(route, {}, 204);
    return;
  }

  if (path === '/api/auth/validate' && method === 'POST') {
    state.requests.authValidate.push({ token: request.headers().authorization || null });
    await respond(route, {
      success: true,
      user: mockUser(actor.role, actor.isSuperAdmin),
      tenantContext: mockTenantContext(actor.role),
    });
    return;
  }

  if (path === '/api/auth/me') {
    await respond(route, {
      success: true,
      user: mockUser(actor.role, actor.isSuperAdmin),
      tenantContext: mockTenantContext(actor.role),
    });
    return;
  }

  if (path === '/api/overview/headline') {
    const totalValue = state.transactions.reduce((sum, transaction) => sum + transaction.totalValue, 0);
    const totalUnits = state.transactions.reduce((sum, transaction) => sum + transaction.quantity, 0);
    const totalCo2e = actualGhgTotal(state.ghgEntries);
    await respond(route, {
      success: true,
      data: {
        total_transactions: state.transactions.length,
        total_value_usd: totalValue,
        total_units: totalUnits,
        reuse_rate: 42,
        total_co2e_kg: totalCo2e,
        actual_co2e_kg: totalCo2e,
        avoided_co2e_kg: avoidedGhgTotal(state.ghgEntries),
        net_co2e_kg: totalCo2e - avoidedGhgTotal(state.ghgEntries),
        avoided_redeploy_co2e_kg: avoidedGhgTotal(state.ghgEntries),
        avoided_recycle_co2e_kg: 0,
        scope1_kg: scopeTotal(state.ghgEntries, 1),
        scope2_kg: scopeTotal(state.ghgEntries, 2),
        scope3_kg: scopeTotal(state.ghgEntries, 3),
        total_parts: state.parts.length,
      },
    });
    return;
  }

  if (path === '/api/parts/vendors/list') {
    await respond(route, {
      success: true,
      vendors: Array.from(new Set(state.parts.map((part) => part.vendor).filter(Boolean))).map((vendor, index) => ({
        id: `vendor-${index + 1}`,
        vendor_name: vendor,
      })),
    });
    return;
  }

  if (path === '/api/parts' && method === 'GET') {
    const query = (url.searchParams.get('search') || url.searchParams.get('q') || '').toLowerCase();
    const vendor = url.searchParams.get('vendor');
    const category = url.searchParams.get('category');
    const filtered = state.parts.filter((part) => {
      const haystack = [part.part_number, part.model_name, part.vendor, part.technology_type, part.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (vendor && part.vendor !== vendor) return false;
      if (category && part.category !== category) return false;
      return true;
    });
    await respond(route, { success: true, parts: filtered, total: filtered.length });
    return;
  }

  if (path === '/api/parts' && method === 'POST') {
    const body = await readJson(request);
    state.requests.partCreates.push(body);
    const newPart: MockPart = {
      id: `part-${state.parts.length + 1}`,
      part_number: String(body.part_number || 'NEW-PART'),
      manufacturer_part_number: nullableText(body.manufacturer_part_number),
      model_name: nullableText(body.model_name),
      vendor: nullableText(body.vendor),
      technology_type: nullableText(body.technology_type),
      weight_kg: nullableNumber(body.weight_kg),
      emission_factor_kg: nullableNumber(body.emission_factor_kg),
      category: nullableText(body.category),
      subcategory: nullableText(body.subcategory),
      description: nullableText(body.description),
      needs_review: Boolean(body.needs_review),
      review_notes: nullableText(body.review_notes),
      created_at: '2026-06-23T08:00:00Z',
      updated_at: '2026-06-23T08:00:00Z',
    };
    state.parts.unshift(newPart);
    await respond(route, { success: true, part: newPart });
    return;
  }

  if (path === '/api/transactions/summary') {
    await respond(route, { summary: buildTransactionSummary(state.transactions) });
    return;
  }

  if (path === '/api/transactions' && method === 'GET') {
    const transactionId = url.searchParams.get('transaction_id');
    const transactions = transactionId
      ? state.transactions.filter((transaction) => transaction.id === transactionId)
      : state.transactions;
    await respond(route, { transactions, total: transactions.length });
    return;
  }

  if (path === '/api/transactions/markets') {
    await respond(route, {
      markets: [
        { id: 'market-vn', marketName: 'Vietnam', country: 'Vietnam', region: 'APAC' },
        { id: 'market-qa', marketName: 'Qatar', country: 'Qatar', region: 'Middle East' },
      ],
    });
    return;
  }

  if (path === '/api/contacts' && method === 'GET') {
    await respond(route, {
      contacts: [
        { id: 'contact-buyer', companyName: 'Circular Buyer Ltd', contactPersonName: 'Buyer Contact', email: 'buyer@example.test' },
      ],
    });
    return;
  }
  if (path === '/api/transactions/warehouses-list') {
    await respond(route, { warehouses: state.warehouses });
    return;
  }

  if (path === '/api/transactions/projects-list') {
    await respond(route, { projects: state.projects.map((project) => ({ id: project.id, projectName: project.name })) });
    return;
  }

  if (path === '/api/transactions/devices-available') {
    await respond(route, { devices: [] });
    return;
  }

  if (path === '/api/transactions' && method === 'POST') {
    const body = await readJson(request);
    state.requests.transactionCreates.push(body);
    const firstItem = Array.isArray(body.items) ? body.items[0] : null;
    const partId = body.part_id || firstItem?.part_id;
    const destinationWarehouseId = body.destination_warehouse_id || firstItem?.destination_warehouse_id;
    const part = state.parts.find((candidate) => candidate.id === partId);
    const warehouse = state.warehouses.find((candidate) => candidate.id === destinationWarehouseId);
    const project = state.projects.find((candidate) => candidate.id === body.project_id);
    const market = body.market_id === 'market-qa'
      ? { marketName: 'Qatar', region: 'Middle East' }
      : { marketName: 'Vietnam', region: 'APAC' };
    const quantity = Number(body.quantity || 1);
    const unitPrice = Number(body.unit_price_usd || 0);
    const transaction: MockTransaction = {
      id: `transaction-${state.transactions.length + 1}`,
      date: String(body.date || '2026-06-23'),
      marketId: nullableText(body.market_id),
      marketName: market.marketName,
      region: market.region,
      movementType: body.movement_type || 'Purchase',
      quantity,
      unitPrice,
      totalValue: quantity * unitPrice,
      vendor: nullableText(body.vendor) || part?.vendor || null,
      partId: part?.id || null,
      partNumber: part?.part_number || nullableText(body.part_number),
      partName: part?.model_name || null,
      technology: part?.technology_type || null,
      category: part?.category || null,
      condition: nullableText(body.condition),
      poNumber: nullableText(body.po_number),
      projectId: project?.id || null,
      projectName: project?.name || null,
      destinationWarehouseId: warehouse?.id || null,
      destinationWarehouseName: warehouse?.name || null,
      destinationWarehouseCode: warehouse?.code || null,
      itemCount: Array.isArray(body.items) ? body.items.length : 1,
    };
    state.transactions.unshift(transaction);
    await respond(route, { success: true, id: transaction.id, transaction });
    return;
  }

  if (/^\/api\/transactions\/[^/]+\/po-upload$/.test(path) && method === 'POST') {
    const formData = await request.postDataBuffer();
    const raw = formData.toString('latin1');
    const fileName = /filename="([^"]+)"/.exec(raw)?.[1] || null;
    const contentType = /Content-Type: ([^\r\n]+)/.exec(raw)?.[1] || null;
    state.requests.poUploads.push({ url: path, fileName, contentType });
    await respond(route, {
      success: true,
      data: {
        transactionId: path.split('/')[3],
        fileName: fileName || 'mock-po.pdf',
        contentType: contentType || 'application/pdf',
        sizeBytes: formData.byteLength,
      },
    });
    return;
  }

  if (/^\/api\/transactions\/[^/]+\/po-download$/.test(path)) {
    await respond(route, { success: true, file_name: 'mock-po.pdf' });
    return;
  }

  if (path === '/api/warehouses' && method === 'GET') {
    await respond(route, { success: true, warehouses: state.warehouses });
    return;
  }

  if (path === '/api/warehouses/inventory/all') {
    await respond(route, { success: true, inventory: state.inventory });
    return;
  }

  if (path === '/api/warehouses/movements/list') {
    await respond(route, { success: true, movements: state.movements });
    return;
  }

  if (path === '/api/warehouses/inventory/parts') {
    const query = (url.searchParams.get('q') || url.searchParams.get('search') || '').toLowerCase();
    const parts = state.parts.filter((part) => {
      const haystack = `${part.part_number} ${part.model_name || ''}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    await respond(route, { success: true, parts });
    return;
  }

  if (path === '/api/warehouses/inventory/move' && method === 'POST') {
    const body = await readJson(request);
    state.requests.inventoryMoves.push(body);
    const part = state.parts.find((candidate) => candidate.id === body.part_id);
    const toWarehouse = state.warehouses.find((candidate) => candidate.id === body.to_warehouse_id);
    const fromWarehouse = state.warehouses.find((candidate) => candidate.id === body.from_warehouse_id);
    const quantity = Number(body.quantity || 0);
    const movement: MockMovement = {
      id: `movement-${state.movements.length + 1}`,
      movement_type: body.movement_type || 'Receive',
      part_number: part?.part_number || 'UNKNOWN',
      quantity,
      condition: body.condition || 'NIB',
      from_warehouse_name: fromWarehouse?.name || null,
      to_warehouse_name: toWarehouse?.name || null,
      reference: nullableText(body.reference),
      notes: nullableText(body.notes),
      created_at: '2026-06-23T08:00:00Z',
    };
    state.movements.unshift(movement);
    if (part && toWarehouse) {
      state.inventory.unshift({
        id: `inventory-${state.inventory.length + 1}`,
        warehouse_id: toWarehouse.id,
        warehouse_name: toWarehouse.name,
        warehouse_code: toWarehouse.code,
        part_id: part.id,
        part_number: part.part_number,
        model_name: part.model_name,
        category: part.category,
        condition: body.condition || 'NIB',
        quantity,
      });
    }
    await respond(route, { success: true, movement });
    return;
  }

  if (path === '/api/projects' && method === 'GET') {
    await respond(route, { projects: state.projects, items: state.projects });
    return;
  }

  if (path === '/api/projects/project-1' && method === 'GET') {
    await respond(route, mockProjectBundle(state));
    return;
  }

  if (path === '/api/projects/project-1/members' && method === 'GET') {
    await respond(route, { members: [] });
    return;
  }
  if (path === '/api/projects/lookups/vendors') {
    await respond(route, { vendors: [{ id: 'vendor-1', name: 'Nokia', category: 'OEM', region: 'APAC' }] });
    return;
  }

  if (path === '/api/projects/lookups/technologies') {
    await respond(route, { technologies: [{ id: 'tech-5g', name: '5G', generation: '5G', description: '5G RAN' }] });
    return;
  }

  if (path === '/api/ghg/categories') {
    await respond(route, {
      success: true,
      data: [
        { id: 1, name: 'Purchased goods and services', stream: 'upstream' },
        { id: 2, name: 'Capital goods', stream: 'upstream' },
      ],
    });
    return;
  }

  if (path === '/api/ghg/report') {
    const report = buildGhgReport(state.ghgEntries);
    await respond(route, { success: true, ...report });
    return;
  }

  if (path === '/api/ghg/entries' && method === 'GET') {
    const scope = url.searchParams.get('scope');
    const entries = scope ? state.ghgEntries.filter((entry) => String(entry.scope) === scope) : state.ghgEntries;
    await respond(route, { success: true, data: entries });
    return;
  }

  if (path === '/api/ghg/entries' && method === 'POST') {
    const body = await readJson(request);
    state.requests.ghgCreates.push(body);
    const entry: MockGhgEntry = {
      id: `ghg-${state.ghgEntries.length + 1}`,
      scope: Number(body.scope || 3),
      category_id: nullableNumber(body.category_id),
      scope3_stream: body.scope === 3 ? 'Purchased goods and services' : null,
      source_description: String(body.source_description || ''),
      activity_data: Number(body.activity_data || 0),
      activity_unit: String(body.activity_unit || ''),
      emission_factor: Number(body.emission_factor || 0),
      emission_factor_unit: String(body.emission_factor_unit || 'kgCO2e'),
      co2e_kg: Number(body.activity_data || 0) * Number(body.emission_factor || 0),
      reporting_period_start: String(body.reporting_period_start || ''),
      reporting_period_end: String(body.reporting_period_end || ''),
      data_quality: String(body.data_quality || 'estimated'),
      created_by_name: 'Admin User',
      source_type: 'manual',
    };
    state.ghgEntries.unshift(entry);
    await respond(route, { success: true, data: entry });
    return;
  }

  if (path === '/api/admin/stats') {
    await respond(route, {
      stats: {
        totalUsers: 3,
        activeUsers: 3,
        adminUsers: 1,
        recentLogins: 2,
        tenants: 1,
        companies: 1,
        projects: state.projects.length,
        auditEvents: 4,
      },
    });
    return;
  }

  if (path === '/api/admin/users') {
    await respond(route, {
      users: [
        {
          id: 'user-admin',
          email: 'admin@techbridge.example',
          name: 'Admin User',
          role: 'Admin',
          status: 'active',
          tenant_id: tenant.id,
          company_id: company.id,
          tenant_name: tenant.name,
          company_name: company.name,
          is_super_admin: true,
          company_count: 1,
        },
      ],
    });
    return;
  }

  if (path === '/api/admin/tenants') {
    await respond(route, { tenants: [tenant] });
    return;
  }

  if (path === '/api/admin/companies') {
    await respond(route, { companies: [company] });
    return;
  }

  if (path === '/api/admin/audit-log') {
    await respond(route, {
      audit: [
        {
          id: 'audit-1',
          action: 'PART_CREATE',
          resource_type: 'part',
          resource_id: 'part-antenna',
          details: 'Mock audit event',
          created_at: '2026-06-23T08:00:00Z',
          user_name: 'Admin User',
          user_email: 'admin@techbridge.example',
          tenant_name: tenant.name,
        },
      ],
    });
    return;
  }

  await respond(route, { success: true });
}

async function respond(route: Route, payload: unknown, status = 200) {
  const origin = route.request().headers().origin || 'http://127.0.0.1:4173';
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      ...corsHeaders,
      'access-control-allow-origin': origin,
    },
    body: status === 204 ? undefined : JSON.stringify(payload),
  });
}

async function readJson(request: Request) {
  const raw = request.postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function scopeTotal(entries: MockGhgEntry[], scope: number) {
  return entries
    .filter((entry) => entry.scope === scope && entry.source_type !== 'transaction')
    .reduce((sum, entry) => sum + entry.co2e_kg, 0);
}

function actualGhgTotal(entries: MockGhgEntry[]) {
  return entries
    .filter((entry) => entry.source_type !== 'transaction')
    .reduce((sum, entry) => sum + entry.co2e_kg, 0);
}

function avoidedGhgTotal(entries: MockGhgEntry[]) {
  return entries
    .filter((entry) => entry.source_type === 'transaction')
    .reduce((sum, entry) => sum + entry.co2e_kg, 0);
}

function buildGhgReport(entries: MockGhgEntry[]) {
  const scope1 = scopeTotal(entries, 1);
  const scope2 = scopeTotal(entries, 2);
  const scope3 = scopeTotal(entries, 3);
  const avoided = avoidedGhgTotal(entries);
  const actual = scope1 + scope2 + scope3;
  return {
    total_kg: actual,
    scope1_kg: scope1,
    scope2_kg: scope2,
    scope3_kg: scope3,
    avoided_co2e_kg: avoided,
    avoided_redeploy_kg: avoided,
    avoided_recycle_kg: 0,
    actual: {
      total_co2e_kg: actual,
      scope1_kg: scope1,
      scope2_kg: scope2,
      scope3_kg: scope3,
      entry_count: entries.filter((entry) => entry.source_type !== 'transaction').length,
      breakdown: [],
    },
    avoided: {
      total_co2e_kg: avoided,
      entry_count: entries.filter((entry) => entry.source_type === 'transaction').length,
      by_movement_type: [
        { movement_type: 'Redeploy', co2e_kg: avoided, entry_count: avoided > 0 ? 1 : 0 },
      ],
      by_part: [],
    },
    net: {
      actual_minus_avoided_co2e_kg: actual - avoided,
    },
  };
}

function buildTransactionSummary(transactions: MockTransaction[]) {
  return {
    total: transactions.length,
    purchases: transactions.filter((transaction) => transaction.movementType === 'Purchase').length,
    sales: transactions.filter((transaction) => transaction.movementType === 'Sale').length,
    redeploys: transactions.filter((transaction) => transaction.movementType === 'Redeploy').length,
    recycles: transactions.filter((transaction) => transaction.movementType === 'Recycle').length,
    totalValue: transactions.reduce((sum, transaction) => sum + transaction.totalValue, 0),
  };
}
