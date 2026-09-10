import { bling } from './bling.js';
import { contaazul } from './contaazul.js';
import { quickbooks } from './quickbooks.js';
import { omie } from './omie.js';
import { odoo } from './odoo.js';

export const PROVIDERS = { bling, contaazul, quickbooks, omie, odoo };

export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`ERP desconhecido: ${name}`);
  return provider;
}
