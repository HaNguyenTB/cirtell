-- Cirtell demo dataset.
-- Source note: the 20 parts below are adapted from the Cirveris seed file
-- C:\TechBridge\TB website\Cirveris\cirveris\workers\seeds\du_seed_01_parts.sql.
-- This file is intentionally outside migrations so test databases stay clean.

-- ---------------------------------------------------------------------------
-- Vendors and 20 high-completeness parts
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO vendors (id, tenant_id, company_id, vendor_name)
VALUES
  ('vendor_demo_ericsson', 'tenant_cirtell_default', 'company_cirtell_default', 'Ericsson'),
  ('vendor_demo_nokia', 'tenant_cirtell_default', 'company_cirtell_default', 'Nokia'),
  ('vendor_demo_huawei', 'tenant_cirtell_default', 'company_cirtell_default', 'Huawei'),
  ('vendor_demo_samsung', 'tenant_cirtell_default', 'company_cirtell_default', 'Samsung Networks'),
  ('vendor_demo_commscope', 'tenant_cirtell_default', 'company_cirtell_default', 'CommScope'),
  ('vendor_demo_kathrein', 'tenant_cirtell_default', 'company_cirtell_default', 'Kathrein'),
  ('vendor_demo_prysmian', 'tenant_cirtell_default', 'company_cirtell_default', 'Prysmian'),
  ('vendor_demo_eltek', 'tenant_cirtell_default', 'company_cirtell_default', 'Eltek'),
  ('vendor_demo_delta', 'tenant_cirtell_default', 'company_cirtell_default', 'Delta');

INSERT OR IGNORE INTO parts (
  id, tenant_id, company_id, part_number, manufacturer_part_number, model_name,
  vendor_id, technology_type, weight_kg, emission_factor_kg,
  manufacture_start_year, manufacture_end_year, category, subcategory,
  description, needs_review, review_notes, created_at, updated_at
)
VALUES
  ('part_demo_air6488', 'tenant_cirtell_default', 'company_cirtell_default', 'KRC161776/1', NULL, 'AIR 6488 Massive MIMO 64T64R', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'ericsson' LIMIT 1), '5G', 20.0, 85.0, 2022, NULL, 'Radio', 'mMIMO', 'Ericsson AIR 6488 64T64R Massive MIMO radio for n78 band', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_aaha5g', 'tenant_cirtell_default', 'company_cirtell_default', '474590A101', NULL, 'AirScale AAHA 5G mMIMO', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'nokia' LIMIT 1), '5G', 18.5, 82.0, 2022, NULL, 'Radio', 'mMIMO', 'Nokia AirScale AAHA 32T32R Massive MIMO Active Antenna for n78', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_aau5258', 'tenant_cirtell_default', 'company_cirtell_default', '02312RBU', NULL, 'AAU5258 64T64R', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'huawei' LIMIT 1), '5G', 25.0, 95.0, 2021, NULL, 'Radio', 'AAU', 'Huawei AAU5258 64T64R Active Antenna Unit for 3.5GHz 5G NR', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_bb6648', 'tenant_cirtell_default', 'company_cirtell_default', 'KDU137921/11', NULL, 'Baseband 6648', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'ericsson' LIMIT 1), '5G', 8.5, 45.0, 2023, NULL, 'BBU', '5G NR', 'Ericsson Baseband 6648 high-capacity 5G NR baseband unit', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_asik', 'tenant_cirtell_default', 'company_cirtell_default', '474418A', NULL, 'AirScale ASIK Baseband', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'nokia' LIMIT 1), '5G', 9.0, 48.0, 2023, NULL, 'BBU', '5G NR', 'Nokia AirScale ASIK System Module for 5G NR processing', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_air3246', 'tenant_cirtell_default', 'company_cirtell_default', 'KRY112262/1', NULL, 'AIR 3246 B78A', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'ericsson' LIMIT 1), '5G', 12.0, 35.0, 2022, NULL, 'Antenna', 'Panel', 'Ericsson AIR 3246 Passive antenna for 5G n78 band', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_radio4480', 'tenant_cirtell_default', 'company_cirtell_default', 'KRC161779/1', NULL, 'Radio 4480 B78 5G SA', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'ericsson' LIMIT 1), '5G', 16.0, 72.0, 2024, NULL, 'Radio', '5G SA', 'Ericsson Radio 4480 B78 5G SA standalone radio mid-band', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_mt6402', 'tenant_cirtell_default', 'company_cirtell_default', 'MT6402', NULL, 'Samsung Compact Macro 5G', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'samsung networks' LIMIT 1), '5G', 14.0, 68.0, 2023, NULL, 'Radio', 'Compact Macro', 'Samsung MT6402 Compact Macro Lightweight 5G mMIMO radio', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_vran_cudu', 'tenant_cirtell_default', 'company_cirtell_default', 'CU-DU-1200', NULL, 'Samsung vRAN CU/DU', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'samsung networks' LIMIT 1), '5G', 11.0, 52.0, 2024, NULL, 'BBU', 'vRAN', 'Samsung vRAN CU/DU Virtualized RAN O-RAN compliant', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_radio4478', 'tenant_cirtell_default', 'company_cirtell_default', 'KRC161714/1', NULL, 'Radio 4478 B3', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'ericsson' LIMIT 1), '4G/LTE', 15.0, 65.0, 2019, NULL, 'Radio', 'RRU', 'Ericsson Radio 4478 B3 High-power LTE radio 1800 MHz', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_flexi_frgq', 'tenant_cirtell_default', 'company_cirtell_default', '473098A101', NULL, 'Flexi RF Module FRGQ', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'nokia' LIMIT 1), '4G/LTE', 12.5, 55.0, 2018, NULL, 'Radio', 'RRU', 'Nokia Flexi RF Module FRGQ Triple-band LTE radio', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_rru3908', 'tenant_cirtell_default', 'company_cirtell_default', '02311BWP', NULL, 'RRU3908 v2', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'huawei' LIMIT 1), '4G/LTE', 14.0, 60.0, 2018, NULL, 'Radio', 'RRU', 'Huawei RRU3908 v2 Multi-mode radio FDD/TDD LTE', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_bb6630', 'tenant_cirtell_default', 'company_cirtell_default', 'KDU137848/11', NULL, 'Baseband 6630', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'ericsson' LIMIT 1), '2G/3G/4G', 7.0, 42.0, 2016, NULL, 'BBU', 'Multi-Standard', 'Ericsson Baseband 6630 Multi-standard GSM/WCDMA/LTE', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_apxvaarr', 'tenant_cirtell_default', 'company_cirtell_default', 'APXVAARR13-43', NULL, 'APXVAARR13 Tri-Sector', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'commscope' LIMIT 1), '4G/LTE', 8.5, 32.0, 2017, NULL, 'Antenna', 'Panel', 'CommScope APXVAARR13 Triple-band panel antenna 700-2700 MHz', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_kathrein742266', 'tenant_cirtell_default', 'company_cirtell_default', '742266', NULL, 'Kathrein 742 266 Tri-Band', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'kathrein' LIMIT 1), '4G/LTE', 7.5, 28.0, 2016, NULL, 'Antenna', 'Panel', 'Kathrein 742 266 Tri-band antenna 800/1800/2600 MHz', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_minilink8200', 'tenant_cirtell_default', 'company_cirtell_default', 'ANS801092/1', NULL, 'MINI-LINK 8200', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'ericsson' LIMIT 1), 'Microwave', 5.0, 22.0, 2020, NULL, 'Microwave', 'IP Backhaul', 'Ericsson MINI-LINK 8200 All-outdoor microwave unit', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_9500mpr', 'tenant_cirtell_default', 'company_cirtell_default', '9500MPR-E', NULL, '9500 MPR E-Band', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'nokia' LIMIT 1), 'Microwave', 6.0, 25.0, 2021, NULL, 'Microwave', 'E-Band', 'Nokia 9500 MPR E-Band High-capacity 5G backhaul', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_fiber48c', 'tenant_cirtell_default', 'company_cirtell_default', 'FBR-SMF-48C', NULL, '48-Core Single Mode Fiber per km', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'prysmian' LIMIT 1), 'Fibre', 120.0, 40.0, 2020, NULL, 'Fibre', 'Backbone', 'Prysmian 48-core single mode fiber cable G.652.D', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_flatpack2', 'tenant_cirtell_default', 'company_cirtell_default', 'FP2-48-3000', NULL, 'Flatpack2 48V/60A Rectifier', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'eltek' LIMIT 1), 'Power', 3.5, 15.0, 2019, NULL, 'Power', 'Rectifier', 'Eltek Flatpack2 48V/60A High-efficiency rectifier', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('part_demo_battery4850', 'tenant_cirtell_default', 'company_cirtell_default', 'BAT-LI-48-50', NULL, 'Li-ion Battery 48V/50Ah', (SELECT id FROM vendors WHERE tenant_id = 'tenant_cirtell_default' AND company_id = 'company_cirtell_default' AND LOWER(TRIM(vendor_name)) = 'delta' LIMIT 1), 'Power', 22.0, 35.0, 2021, NULL, 'Battery', 'Lithium-Ion', 'Delta Li-ion battery 48V/50Ah 10-year design life', 0, 'Copied from Cirveris seed data for Cirtell demo coverage.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Warehouse, zones and stock
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO warehouses (
  id, tenant_id, company_id, name, code, address, city, country,
  capacity_units, status, notes, created_at, updated_at
)
VALUES (
  'wh_demo_circularity_hub', 'tenant_cirtell_default', 'company_cirtell_default',
  'Cirtell Circularity Hub', 'CIR-HUB', 'Lot C2, Hoa Lac High Tech Park',
  'Hanoi', 'Vietnam', 2500, 'active',
  'Demo warehouse for circular telecom asset intake, refurbishment and redeployment.',
  '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'
);

INSERT OR IGNORE INTO warehouse_zones (
  id, tenant_id, company_id, warehouse_id, name, zone_type, capacity_units, created_at
)
VALUES
  ('zone_demo_receiving', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'Receiving Dock', 'receiving', 400, '2026-06-28T00:00:00.000Z'),
  ('zone_demo_refurbished', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'Refurbished Ready Stock', 'storage', 900, '2026-06-28T00:00:00.000Z'),
  ('zone_demo_shipping', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'Outbound Shipping', 'shipping', 300, '2026-06-28T00:00:00.000Z'),
  ('zone_demo_scrap', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'Recycle Scrap Cage', 'storage', 200, '2026-06-28T00:00:00.000Z');

INSERT OR IGNORE INTO inventory (
  id, tenant_id, company_id, warehouse_id, zone_id, part_id, quantity, condition, last_counted_at, updated_at
)
VALUES
  ('inv_demo_air6488_good', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_refurbished', 'part_demo_air6488', 7, 'Good', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('inv_demo_aaha_new', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_receiving', 'part_demo_aaha5g', 6, 'New', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('inv_demo_aau_good', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_refurbished', 'part_demo_aau5258', 5, 'Good', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('inv_demo_asik_good', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_shipping', 'part_demo_asik', 2, 'Good', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('inv_demo_bb6630_scrap', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_scrap', 'part_demo_bb6630', 4, 'Scrap', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('inv_demo_flatpack_good', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_shipping', 'part_demo_flatpack2', 3, 'Good', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('inv_demo_battery_scrap', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_scrap', 'part_demo_battery4850', 3, 'Scrap', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Transaction reference data and project context
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO markets (id, tenant_id, company_id, market_name, country, region)
VALUES
  ('market_demo_vn_circularity', 'tenant_cirtell_default', 'company_cirtell_default', 'Vietnam Circularity Market', 'Vietnam', 'APAC'),
  ('market_demo_apac_secondary', 'tenant_cirtell_default', 'company_cirtell_default', 'APAC Secondary Telecom Market', 'Regional', 'APAC');

INSERT OR IGNORE INTO contacts (
  id, tenant_id, company_id, company_name, contact_person_name, email, phone,
  city, country, notes, created_at, updated_at
)
VALUES
  ('contact_demo_hanoi_mobile', 'tenant_cirtell_default', 'company_cirtell_default', 'Hanoi Mobile Redeployments', 'Linh Tran', 'linh.tran@example.com', '+84 24 5555 0101', 'Hanoi', 'Vietnam', 'Demo customer for redeploy and sale transactions.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('contact_demo_recycler', 'tenant_cirtell_default', 'company_cirtell_default', 'Vietnam Certified Recycler', 'Minh Pham', 'minh.pham@example.com', '+84 28 5555 0202', 'Ho Chi Minh City', 'Vietnam', 'Demo recycler for end-of-life telecom assets.', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z');

INSERT OR IGNORE INTO projects (
  id, tenant_id, company_id, name, description, internal_reference, operator,
  region, country, site_name, site_id, location_type, source_warehouse_id,
  location_address, requires_dismantling, timeframe_start, timeframe_end,
  currency, esg_methodology_version, compliance_regime,
  contains_sensitive_data, contains_restricted_goods, compliance_notes,
  status, budget_total, created_by, created_at, updated_at
)
VALUES (
  'project_demo_ran_refresh_2026', 'tenant_cirtell_default', 'company_cirtell_default',
  'RAN Refresh Circularity Program', 'Demo project linking recovered RAN equipment to parts, transactions, warehouse stock and carbon reporting.',
  'CIR-DEMO-2026-001', 'Cirtell Demo Operator', 'Northern Vietnam', 'Vietnam',
  'Hoa Lac Trial Cluster', 'HLC-DEMO-01', 'regional_warehouse', 'wh_demo_circularity_hub',
  'Hoa Lac High Tech Park, Hanoi', 1, '2026-06-01', '2026-08-31',
  'USD', 'Cirtell avoided-emissions v1', 'Internal circularity controls',
  0, 0, 'Demo project seeded for feature walkthrough.', 'in-progress',
  125000, NULL, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'
);

-- Transaction-linked materials are projected at read time. Keep only genuinely
-- project-managed equipment here so the demo does not double count assets.
DELETE FROM project_equipment
WHERE id IN ('equip_demo_air6488', 'equip_demo_bb6630');

INSERT OR IGNORE INTO project_equipment (
  id, project_id, tenant_id, company_id, item_name, asset_tag, serial_number,
  vendor, category, quantity, condition, current_stage, weight_kg,
  estimated_reuse_value, co2_avoided_kg, notes, part_id, created_at, updated_at
)
VALUES (
  'equip_demo_site_test_kit', 'project_demo_ran_refresh_2026',
  'tenant_cirtell_default', 'company_cirtell_default',
  'Site survey and RF test kit', 'CIR-SURVEY-KIT-001', 'SN-SURVEY-DEMO',
  'Cirtell Demo Operator', 'Project tooling', 1, 'Good', 'assessment', 12.0,
  1500, 0, 'Project-managed tooling; not generated from a transaction.', NULL,
  '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'
);
INSERT OR IGNORE INTO project_workflow_stages (id, project_id, stage, label, status, sort_order, completed_at, updated_at)
VALUES
  ('stage_demo_assessment', 'project_demo_ran_refresh_2026', 'assessment', 'Assessment', 'completed', 1, '2026-06-15T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('stage_demo_refurbishment', 'project_demo_ran_refresh_2026', 'refurbishment', 'Refurbishment', 'in_progress', 2, NULL, '2026-06-28T00:00:00.000Z'),
  ('stage_demo_redeployment', 'project_demo_ran_refresh_2026', 'redeployment', 'Redeployment', 'not_started', 3, NULL, '2026-06-28T00:00:00.000Z');

INSERT OR IGNORE INTO project_workflow_tasks (id, project_id, stage_id, title, status, due_date, created_at, updated_at)
VALUES
  ('task_demo_scope', 'project_demo_ran_refresh_2026', 'stage_demo_assessment', 'Confirm asset scope and compliance checks', 'done', '2026-06-15', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('task_demo_refurb', 'project_demo_ran_refresh_2026', 'stage_demo_refurbishment', 'Complete bench testing for reusable radios', 'open', '2026-07-10', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z');

-- Transaction values are projected into Financials. Retain only independent
-- project costs here; remove the legacy manually mirrored redeployment value.
DELETE FROM project_financials
WHERE id = 'fin_demo_reuse_value';

INSERT OR IGNORE INTO project_financials (id, project_id, tenant_id, company_id, type, category, description, amount, currency, stage, incurred_at, created_at)
VALUES (
  'fin_demo_refurb_cost', 'project_demo_ran_refresh_2026',
  'tenant_cirtell_default', 'company_cirtell_default', 'cost', 'Refurbishment',
  'Testing and repair labor not represented by a transaction', 14500, 'USD',
  'refurbishment', '2026-06-25', '2026-06-28T00:00:00.000Z'
);
INSERT OR IGNORE INTO project_logistics (id, project_id, tenant_id, company_id, shipment_type, status, carrier, origin, destination, scheduled_date, tracking_reference, estimated_cost, notes)
VALUES
  ('log_demo_collection', 'project_demo_ran_refresh_2026', 'tenant_cirtell_default', 'company_cirtell_default', 'collection', 'in_transit', 'Cirtell Demo Logistics', 'Hoa Lac Trial Cluster', 'Cirtell Circularity Hub', '2026-06-20', 'CIR-DEMO-TRK-001', 2300, 'Demo inbound logistics leg.');

INSERT OR IGNORE INTO project_evidence (
  id, project_id, tenant_id, company_id, title, evidence_type, stage,
  file_url, notes, uploaded_by, uploaded_at, r2_key, file_name, file_size, content_type
)
VALUES (
  'evidence_demo_scope', 'project_demo_ran_refresh_2026', 'tenant_cirtell_default', 'company_cirtell_default',
  'Scope sign-off memo', 'document', 'assessment', NULL,
  'Metadata-only demo evidence row. No R2 object is required.', NULL,
  '2026-06-28T00:00:00.000Z', 'demo/project_demo_ran_refresh_2026/scope-signoff.pdf',
  'scope-signoff.pdf', 24576, 'application/pdf'
);

INSERT OR IGNORE INTO project_activity (id, project_id, user_id, user_name, action, entity_type, entity_id, details, created_at)
VALUES
  ('activity_demo_project_created', 'project_demo_ran_refresh_2026', NULL, 'System seed', 'CREATE_PROJECT', 'projects', 'project_demo_ran_refresh_2026', 'Seeded Cirtell demo project.', '2026-06-28T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- 10 mixed transactions and inventory sync records
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO transactions (
  id, tenant_id, company_id, date, movement_type, quantity, unit_price_usd,
  vendor, part_id, serial_number, condition, po_number, market_id,
  source_warehouse_id, destination_warehouse_id, project_id, contact_id,
  inventory_sync_status, inventory_sync_version, inventory_synced_at,
  created_at, updated_at
)
VALUES
  ('tx_demo_001_purchase_air6488', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-01', 'Purchase', 8, 12500, 'Ericsson', 'part_demo_air6488', NULL, 'Good', 'PO-DEMO-0001', 'market_demo_vn_circularity', NULL, 'wh_demo_circularity_hub', 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_002_purchase_aaha', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-03', 'Purchase', 6, 11800, 'Nokia', 'part_demo_aaha5g', NULL, 'New', 'PO-DEMO-0002', 'market_demo_vn_circularity', NULL, 'wh_demo_circularity_hub', 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_003_purchase_aau', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-05', 'Purchase', 5, 13200, 'Huawei', 'part_demo_aau5258', NULL, 'Good', 'PO-DEMO-0003', 'market_demo_vn_circularity', NULL, 'wh_demo_circularity_hub', 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_004_purchase_bb6648', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-07', 'Purchase', 4, 7200, 'Ericsson', 'part_demo_bb6648', NULL, 'New', 'PO-DEMO-0004', 'market_demo_vn_circularity', NULL, 'wh_demo_circularity_hub', 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_005_sale_air6488', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-10', 'Sale', 1, 14800, 'Ericsson', 'part_demo_air6488', NULL, 'Good', 'SO-DEMO-0005', 'market_demo_apac_secondary', 'wh_demo_circularity_hub', NULL, 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_006_sale_flexi', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-12', 'Sale', 2, 2500, 'Nokia', 'part_demo_flexi_frgq', NULL, 'Good', 'SO-DEMO-0006', 'market_demo_apac_secondary', 'wh_demo_circularity_hub', NULL, 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_007_redeploy_asik', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-15', 'Redeploy', 2, 9500, 'Nokia', 'part_demo_asik', NULL, 'Good', 'RD-DEMO-0007', 'market_demo_vn_circularity', 'wh_demo_circularity_hub', 'wh_demo_circularity_hub', 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_008_redeploy_flatpack', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-17', 'Redeploy', 3, 900, 'Eltek', 'part_demo_flatpack2', NULL, 'Good', 'RD-DEMO-0008', 'market_demo_vn_circularity', 'wh_demo_circularity_hub', 'wh_demo_circularity_hub', 'project_demo_ran_refresh_2026', 'contact_demo_hanoi_mobile', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_009_recycle_bb6630', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-20', 'Recycle', 4, 120, 'Ericsson', 'part_demo_bb6630', NULL, 'Scrap', 'RC-DEMO-0009', 'market_demo_vn_circularity', 'wh_demo_circularity_hub', NULL, 'project_demo_ran_refresh_2026', 'contact_demo_recycler', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z'),
  ('tx_demo_010_recycle_battery', 'tenant_cirtell_default', 'company_cirtell_default', '2026-06-22', 'Recycle', 3, 80, 'Delta', 'part_demo_battery4850', NULL, 'Scrap', 'RC-DEMO-0010', 'market_demo_vn_circularity', 'wh_demo_circularity_hub', NULL, 'project_demo_ran_refresh_2026', 'contact_demo_recycler', 'synced', 1, '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z', '2026-06-28T00:00:00.000Z');

INSERT OR IGNORE INTO transaction_items (
  id, tenant_id, company_id, transaction_id, part_id, condition, quantity, unit_price_usd,
  source_warehouse_id, destination_warehouse_id, notes, created_at, updated_at
)
SELECT
  'item_' || id, tenant_id, company_id, id, part_id, condition, quantity, unit_price_usd,
  source_warehouse_id, destination_warehouse_id, 'Demo transaction line item', created_at, updated_at
FROM transactions
WHERE id LIKE 'tx_demo_%';

INSERT OR IGNORE INTO inventory_movements (
  id, tenant_id, company_id, from_warehouse_id, from_zone_id, to_warehouse_id, to_zone_id,
  part_id, quantity, movement_type, reference, notes, created_by, created_at,
  transaction_id, transaction_item_id, condition, sync_source, sync_version,
  reversal_of_movement_id, idempotency_key, effective_at
)
VALUES
  ('move_demo_001', 'tenant_cirtell_default', 'company_cirtell_default', NULL, NULL, 'wh_demo_circularity_hub', 'zone_demo_refurbished', 'part_demo_air6488', 8, 'Receive', 'PO-DEMO-0001', 'Auto-sync demo purchase receive.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_001_purchase_air6488', 'item_tx_demo_001_purchase_air6488', 'Good', 'transaction', 1, NULL, 'demo:tx_demo_001_purchase_air6488:item:0', '2026-06-01'),
  ('move_demo_002', 'tenant_cirtell_default', 'company_cirtell_default', NULL, NULL, 'wh_demo_circularity_hub', 'zone_demo_receiving', 'part_demo_aaha5g', 6, 'Receive', 'PO-DEMO-0002', 'Auto-sync demo purchase receive.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_002_purchase_aaha', 'item_tx_demo_002_purchase_aaha', 'New', 'transaction', 1, NULL, 'demo:tx_demo_002_purchase_aaha:item:0', '2026-06-03'),
  ('move_demo_003', 'tenant_cirtell_default', 'company_cirtell_default', NULL, NULL, 'wh_demo_circularity_hub', 'zone_demo_refurbished', 'part_demo_aau5258', 5, 'Receive', 'PO-DEMO-0003', 'Auto-sync demo purchase receive.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_003_purchase_aau', 'item_tx_demo_003_purchase_aau', 'Good', 'transaction', 1, NULL, 'demo:tx_demo_003_purchase_aau:item:0', '2026-06-05'),
  ('move_demo_004', 'tenant_cirtell_default', 'company_cirtell_default', NULL, NULL, 'wh_demo_circularity_hub', 'zone_demo_receiving', 'part_demo_bb6648', 4, 'Receive', 'PO-DEMO-0004', 'Auto-sync demo purchase receive.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_004_purchase_bb6648', 'item_tx_demo_004_purchase_bb6648', 'New', 'transaction', 1, NULL, 'demo:tx_demo_004_purchase_bb6648:item:0', '2026-06-07'),
  ('move_demo_005', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_refurbished', NULL, NULL, 'part_demo_air6488', 1, 'Ship', 'SO-DEMO-0005', 'Auto-sync demo sale ship.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_005_sale_air6488', 'item_tx_demo_005_sale_air6488', 'Good', 'transaction', 1, NULL, 'demo:tx_demo_005_sale_air6488:item:0', '2026-06-10'),
  ('move_demo_006', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_refurbished', NULL, NULL, 'part_demo_flexi_frgq', 2, 'Ship', 'SO-DEMO-0006', 'Auto-sync demo sale ship.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_006_sale_flexi', 'item_tx_demo_006_sale_flexi', 'Good', 'transaction', 1, NULL, 'demo:tx_demo_006_sale_flexi:item:0', '2026-06-12'),
  ('move_demo_007', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_refurbished', 'wh_demo_circularity_hub', 'zone_demo_shipping', 'part_demo_asik', 2, 'Transfer', 'RD-DEMO-0007', 'Auto-sync demo redeploy transfer.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_007_redeploy_asik', 'item_tx_demo_007_redeploy_asik', 'Good', 'transaction', 1, NULL, 'demo:tx_demo_007_redeploy_asik:item:0', '2026-06-15'),
  ('move_demo_008', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_refurbished', 'wh_demo_circularity_hub', 'zone_demo_shipping', 'part_demo_flatpack2', 3, 'Transfer', 'RD-DEMO-0008', 'Auto-sync demo redeploy transfer.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_008_redeploy_flatpack', 'item_tx_demo_008_redeploy_flatpack', 'Good', 'transaction', 1, NULL, 'demo:tx_demo_008_redeploy_flatpack:item:0', '2026-06-17'),
  ('move_demo_009', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_scrap', NULL, NULL, 'part_demo_bb6630', 4, 'Ship', 'RC-DEMO-0009', 'Auto-sync demo recycle ship.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_009_recycle_bb6630', 'item_tx_demo_009_recycle_bb6630', 'Scrap', 'transaction', 1, NULL, 'demo:tx_demo_009_recycle_bb6630:item:0', '2026-06-20'),
  ('move_demo_010', 'tenant_cirtell_default', 'company_cirtell_default', 'wh_demo_circularity_hub', 'zone_demo_scrap', NULL, NULL, 'part_demo_battery4850', 3, 'Ship', 'RC-DEMO-0010', 'Auto-sync demo recycle ship.', NULL, '2026-06-28T00:00:00.000Z', 'tx_demo_010_recycle_battery', 'item_tx_demo_010_recycle_battery', 'Scrap', 'transaction', 1, NULL, 'demo:tx_demo_010_recycle_battery:item:0', '2026-06-22');

-- ---------------------------------------------------------------------------
-- Carbon accounting data: actual emissions plus transaction avoided emissions
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO ghg_emission_entries (
  id, tenant_id, company_id, created_by, scope, category_id, scope3_stream,
  source_description, activity_data, activity_unit, emission_factor,
  emission_factor_unit, emission_factor_source, co2e_kg,
  reporting_period_start, reporting_period_end, data_quality, methodology_notes,
  source_type, transaction_id, part_id, calculation_method, factor_source, source_movement_type
)
VALUES
  ('ghg_demo_scope1_diesel', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 1, NULL, NULL, 'Diesel used by collection trucks', 420, 'litre', 2.68, 'kgCO2e/litre', 'DEFRA 2025 demo factor', 1125.6, '2026-06-01', '2026-06-30', 'estimated', 'Demo Scope 1 logistics fuel entry.', 'manual', NULL, NULL, 'activity_factor_v1', 'DEFRA 2025 demo factor', NULL),
  ('ghg_demo_scope2_power', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 2, NULL, NULL, 'Warehouse electricity for refurbishment', 1800, 'kWh', 0.52, 'kgCO2e/kWh', 'Vietnam grid demo factor', 936.0, '2026-06-01', '2026-06-30', 'estimated', 'Demo Scope 2 warehouse energy entry.', 'manual', NULL, NULL, 'activity_factor_v1', 'Vietnam grid demo factor', NULL),
  ('ghg_demo_scope3_inbound', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 3, 4, 'upstream', 'Inbound transportation of recovered RAN equipment', 950, 'tonne-km', 0.11, 'kgCO2e/tonne-km', 'Logistics demo factor', 104.5, '2026-06-01', '2026-06-30', 'estimated', 'Scope 3 upstream transport demo.', 'manual', NULL, NULL, 'activity_factor_v1', 'Logistics demo factor', NULL),
  ('ghg_demo_scope3_waste', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 3, 5, 'upstream', 'Packaging and unusable material waste', 1.8, 'tonne', 350, 'kgCO2e/tonne', 'Waste treatment demo factor', 630.0, '2026-06-01', '2026-06-30', 'estimated', 'Scope 3 waste demo.', 'manual', NULL, NULL, 'activity_factor_v1', 'Waste treatment demo factor', NULL),
  ('ghg_demo_avoided_asik', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 3, 2, 'upstream', 'Avoided manufacturing emissions from redeployed ASIK baseband', 2, 'unit', 48.0, 'kgCO2e/unit', 'parts.emission_factor_kg', 96.0, '2026-06-15', '2026-06-15', 'estimated', 'Generated-style avoided emissions demo entry.', 'transaction', 'tx_demo_007_redeploy_asik', 'part_demo_asik', 'avoided_emissions_v1', 'parts.emission_factor_kg', 'Redeploy'),
  ('ghg_demo_avoided_flatpack', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 3, 2, 'upstream', 'Avoided manufacturing emissions from redeployed rectifiers', 3, 'unit', 15.0, 'kgCO2e/unit', 'parts.emission_factor_kg', 45.0, '2026-06-17', '2026-06-17', 'estimated', 'Generated-style avoided emissions demo entry.', 'transaction', 'tx_demo_008_redeploy_flatpack', 'part_demo_flatpack2', 'avoided_emissions_v1', 'parts.emission_factor_kg', 'Redeploy'),
  ('ghg_demo_avoided_bb6630', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 3, 12, 'downstream', 'Avoided disposal emissions from recycled Baseband 6630 units', 4, 'unit', 42.0, 'kgCO2e/unit', 'parts.emission_factor_kg', 168.0, '2026-06-20', '2026-06-20', 'estimated', 'Generated-style avoided emissions demo entry.', 'transaction', 'tx_demo_009_recycle_bb6630', 'part_demo_bb6630', 'avoided_emissions_v1', 'parts.emission_factor_kg', 'Recycle'),
  ('ghg_demo_avoided_battery', 'tenant_cirtell_default', 'company_cirtell_default', NULL, 3, 12, 'downstream', 'Avoided disposal emissions from recycled lithium batteries', 3, 'unit', 35.0, 'kgCO2e/unit', 'parts.emission_factor_kg', 105.0, '2026-06-22', '2026-06-22', 'estimated', 'Generated-style avoided emissions demo entry.', 'transaction', 'tx_demo_010_recycle_battery', 'part_demo_battery4850', 'avoided_emissions_v1', 'parts.emission_factor_kg', 'Recycle');

INSERT OR IGNORE INTO audit_log (
  id, user_id, action, resource_type, resource_id, details, tenant_id, company_id, created_at
)
VALUES (
  'audit_demo_seed_dataset', NULL, 'SEED_DEMO_DATA', 'demo_dataset', 'cirtell_demo_dataset',
  '{"source":"Cirveris seed data read-only","parts":20,"transactions":10,"warehouse":1,"carbon_entries":8}',
  'tenant_cirtell_default', 'company_cirtell_default', '2026-06-28T00:00:00.000Z'
);
