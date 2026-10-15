export type PaymentSessionInput = {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  idempotencyKey: string;
  returnUrl: string;
};

export type PaymentSession = {
  provider: string;
  reference: string;
  status: 'requires_action' | 'authorized' | 'failed';
  redirectUrl: string | null;
};

export interface PaymentProvider {
  readonly name: string;
  createSession(input: PaymentSessionInput): Promise<PaymentSession>;
  cancel(reference: string, idempotencyKey: string): Promise<void>;
  refund(
    reference: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<{ reference: string }>;
}

export function paymentProvider(): PaymentProvider {
  // Swap this adapter for Stripe, PayPal, Adyen, or another HTTP-based provider.
  // Checkout totals, order creation, and inventory stay provider-neutral.
  return mockPaymentProvider;
}

const mockPaymentProvider: PaymentProvider = {
  name: 'mock',
  async createSession(input) {
    return {
      provider: 'mock',
      reference: `mock_${input.orderId}`,
      status: 'authorized',
      redirectUrl: null,
    };
  },
  async cancel() {
    return undefined;
  },
  async refund(reference, amountCents) {
    return { reference: `refund_${reference}_${amountCents}` };
  },
};
