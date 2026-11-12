import { z } from 'zod'

const money = z.object({
  currency_code: z.string().length(3).describe('ISO-4217 currency code, for example USD'),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/).describe('Decimal amount as a string, for example 35.00'),
})

const orderItem = z.object({
  name: z.string().min(1).max(127),
  description: z.string().max(127).optional(),
  sku: z.string().max(127).optional(),
  quantity: z.string().regex(/^\d+$/).default('1'),
  unit_amount: money,
})

export const createSetupTokenSchema = z.object({
  usage_type: z.enum(['MERCHANT', 'PLATFORM']).default('MERCHANT').describe('Who stores the payment method'),
  customer_type: z.enum(['CONSUMER', 'BUSINESS']).default('CONSUMER'),
  usage_pattern: z.string().default('UNSCHEDULED_POSTPAID').describe('How the saved method will be used later'),
  description: z.string().max(127).describe('Text the payer sees on the PayPal approval screen'),
  return_url: z.string().url(),
  cancel_url: z.string().url(),
  customer_id: z.string().optional(),
})

export const createPaymentTokenSchema = z.object({
  setup_token_id: z.string().min(1).describe('Setup token the payer approved'),
})

export const getPaymentTokenSchema = z.object({
  payment_token_id: z.string().min(1),
})

export const listCustomerTokensSchema = z.object({
  customer_id: z.string().min(1),
  page_size: z.number().int().min(1).max(10).default(5),
})

export const chargeTokenSchema = z.object({
  vault_id: z.string().min(1).describe('Payment token id saved earlier'),
  invoice_id: z.string().min(1).max(127).describe('Merchant reference, shown on the PayPal receipt'),
  request_id: z.string().min(1).max(108).describe('PayPal-Request-Id header; reuse it to retry safely'),
  items: z.array(orderItem).min(1).max(20),
  amount: money.describe('Must equal the sum of the items'),
  with_stored_credential: z.boolean().default(false).describe('Also send stored_credential (merchant initiated, subsequent, unscheduled postpaid)'),
})

export const deletePaymentTokenSchema = z.object({
  payment_token_id: z.string().min(1),
})
