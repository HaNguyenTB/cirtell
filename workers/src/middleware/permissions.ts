/**
 * Role-based permissions for tenant-scoped Cirtell routes.
 * Roles: Admin, User, Viewer
 */

import type { Context } from 'hono';
import type { Env } from '../index';
import type { User } from './auth';

export enum Permission {
  VIEW_DASHBOARD = 'view_dashboard',
  VIEW_PARTS = 'view_parts',
  EDIT_PARTS = 'edit_parts',
  VIEW_TRANSACTIONS = 'view_transactions',
  EDIT_TRANSACTIONS = 'edit_transactions',
  DELETE_TRANSACTIONS = 'delete_transactions',
  VIEW_CARBON = 'view_carbon',
  EDIT_CARBON = 'edit_carbon',
  VIEW_WAREHOUSE = 'view_warehouse',
  EDIT_WAREHOUSE = 'edit_warehouse',
  MANAGE_USERS = 'manage_users',
  EXPORT_DATA = 'export_data',
}

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  Admin: Object.values(Permission),
  User: [
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_PARTS,
    Permission.EDIT_PARTS,
    Permission.VIEW_TRANSACTIONS,
    Permission.EDIT_TRANSACTIONS,
    Permission.VIEW_CARBON,
    Permission.EDIT_CARBON,
    Permission.VIEW_WAREHOUSE,
    Permission.EDIT_WAREHOUSE,
    Permission.EXPORT_DATA,
  ],
  Viewer: [
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_PARTS,
    Permission.VIEW_TRANSACTIONS,
    Permission.VIEW_CARBON,
    Permission.VIEW_WAREHOUSE,
  ],
};

export function hasPermission(role: string, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

/**
 * Middleware factory: require a specific permission
 */
export function requirePermission(permission: Permission) {
  return async (c: Context<{ Bindings: Env; Variables: { user: User } }>, next: any) => {
    const user = c.get('user');
    if (!hasPermission(user.role, permission)) {
      return c.json({ success: false, error: 'Insufficient permissions' }, 403);
    }
    await next();
  };
}
