import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { WallosClient, WallosError } from './wallos.js';

const id = z.number().int().positive();
const flag = z.union([z.literal(0), z.literal(1)]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Expected a valid YYYY-MM-DD date');
const fields = {
  name: z.string().trim().min(1).max(255), price: z.number().finite().nonnegative(),
  currency_id: id, frequency: id, cycle: z.number().int().min(1).max(4).describe('1=days, 2=weeks, 3=months, 4=years'),
  next_payment: date, start_date: date.optional(), auto_renew: flag.optional(),
  payment_method_id: id.optional(), payer_user_id: id.optional(), category_id: id.optional(),
  notes: z.string().max(10000).optional(), url: z.union([z.string().url(), z.literal('')]).optional(),
  notify: flag.optional(), notify_days_before: z.number().int().nonnegative().optional(),
  inactive: flag.optional(), cancellation_date: date.optional(), replacement_subscription_id: id.optional(),
};
const create = z.object(fields).strict();
const update = create.partial().extend({
  id,
  payment_method_id: id.nullable().optional(), payer_user_id: id.nullable().optional(),
  category_id: id.nullable().optional(), cancellation_date: date.nullable().optional(),
  notify_days_before: z.number().int().nonnegative().nullable().optional(), replacement_subscription_id: id.nullable().optional(),
}).refine(value => Object.keys(value).length > 1, 'Supply at least one field to update');
const ids = z.array(id).min(1).max(100).optional();

export function createMcp(client: WallosClient): McpServer {
  const server = new McpServer({ name: 'wallos-mcp', version: '1.0.0' });
  function tool(name: string, description: string, schema: z.AnyZodObject | typeof update,
    readOnly: boolean, run: (args: Record<string, unknown>) => Promise<Record<string, unknown>>) {
    server.registerTool(name, {
      description, inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: true },
    }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const data = await run(args);
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof WallosError ? error.message : 'Tool execution failed.' }] };
      }
    });
  }
  tool('list_subscriptions', 'List the configured user’s subscriptions. Filter by reference IDs; state 0 is active, 1 inactive.', z.object({
    member: ids, category: ids, payment: ids, state: flag.optional(),
    sort: z.enum(['name','id','next_payment','price','payer_user_id','category_id','payment_method_id','inactive','alphanumeric']).optional(),
    convert_currency: z.boolean().optional(), disabled_to_bottom: z.boolean().optional(),
  }).strict(), true, args => client.request('subscriptions/get_subscriptions', args));
  tool('get_subscription', 'Get one subscription by ID.', z.object({ id, convert_currency: z.boolean().optional() }).strict(), true,
    args => client.request('subscriptions/get_subscription', args));
  tool('create_subscription', 'Create a subscription. Use get_reference_data for IDs. Dates are YYYY-MM-DD; price is per billing period.', create, false,
    args => client.request('subscriptions/set_subscriptions', { ...args, action: 'add' }));
  tool('update_subscription', 'Update supplied fields only. Null clears nullable fields. Use 0/1 for flags.', update, false,
    args => client.request('subscriptions/set_subscriptions', { ...args, action: 'edit' }));
  tool('delete_subscription', 'Permanently delete a subscription. Obtain user confirmation before supplying confirm=true.', z.object({ id, confirm: z.literal(true) }).strict(), false,
    args => client.request('subscriptions/set_subscriptions', { id: args.id, action: 'delete' }));
  tool('get_monthly_cost', 'Get Wallos’s monthly cost estimate in the main currency. Preserve exchange-rate warnings.', z.object({ month: z.number().int().min(1).max(12), year: z.number().int().min(1900).max(9999) }).strict(), true,
    args => client.request('subscriptions/get_monthly_cost', args));
  tool('get_reference_data', 'Get categories, currencies, payment methods, and household members for subscription IDs.', z.object({}).strict(), true, async () => {
    const groups = ['categories', 'currencies', 'payment_methods', 'household'];
    const entries = await Promise.all(groups.map(async group => [group, await client.request(`${group}/get_${group}`)]));
    return Object.fromEntries(entries);
  });
  return server;
}
