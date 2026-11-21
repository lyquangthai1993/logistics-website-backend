import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InboundOrderItemDto } from './quick-create-inbound-order.dto';
import { ConfirmOutboundDto } from './confirm-outbound.dto';

describe('province validation', () => {
  it('should trim and reject a blank inbound province', async () => {
    const dto = plainToInstance(InboundOrderItemDto, { province: '   ' });

    expect(dto.province).toBe('');
    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'province' }),
      ]),
    );
  });

  it('should validate province on outbound item payloads', async () => {
    const dto = plainToInstance(ConfirmOutboundDto, {
      mode: 'CUSTOMER',
      items: [{ orderId: 1, province: '   ' }],
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'items',
          children: expect.any(Array),
        }),
      ]),
    );
  });
});
