import { DomainError } from './db.js';
export type Role = 'HOST' | 'SALES' | 'LOGISTICS' | 'WAREHOUSE' | 'FINANCE' | 'BRANDING' | 'IT' | 'DEALER';
export interface Actor { type: 'EMPLOYEE' | 'DEALER'; id: string; role: Role }
/** Enforced on the SERVER for every request; the browser UI only hides buttons. */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  HOST: ['*'],
  SALES: ['order.view.indicator', 'payment.proof.upload', 'order.create', 'dealer.read', 'freebie.manage', 'target.read.own', 'order.read.own_dealers', 'preorder.create', 'sample.create', 'attendance.own', 'inventory.read'],
  LOGISTICS: ['logistics.read', 'order.view.indicator', 'payment.proof.upload', 'invoice.upload', 'tracking.write', 'order.read.paid', 'inventory.edit', 'sample.stock.edit', 'inventory.read', 'attendance.own'],
  WAREHOUSE: ['logistics.read', 'order.mark.seen', 'shift.open', 'shift.close', 'packing.update', 'order.read.paid', 'document.read', 'inventory.edit', 'sample.stock.edit', 'inventory.read', 'attendance.own'],
  FINANCE: ['logistics.read', 'document.correct', 'payment.verify', 'payment.proof.upload', 'inventory.edit', 'inventory.approve', 'inventory.cost.read', 'order.view.indicator', 'employee.view', 'finance.read', 'export.csv', 'order.read.all', 'inventory.read', 'attendance.own'],
  BRANDING: ['attendance.own', 'task.own'],
  IT: ['attendance.own', 'task.own'],
  DEALER: ['payment.proof.upload.own', 'order.create.own', 'order.read.own', 'preorder.create.own', 'inventory.read'] };
export const can = (a: Actor, perm: string) => ROLE_PERMISSIONS[a.role].includes('*') || ROLE_PERMISSIONS[a.role].includes(perm);
export function assertCan(a: Actor, perm: string) { if (!can(a, perm)) throw new DomainError('FORBIDDEN', `Role ${a.role} may not ${perm}`); }
