import { vi, describe, it, expect, beforeEach } from 'vitest';
import ProductModel from '../Product';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => {
  return {
    default: {
      product: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

describe('ProductModel Compatibility Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expose standard Mongoose query builder chain', () => {
    const query = ProductModel.find({});
    expect(query.sort).toBeTypeOf('function');
    expect(query.lean).toBeTypeOf('function');
    expect(query.skip).toBeTypeOf('function');
    expect(query.limit).toBeTypeOf('function');
    expect(query.then).toBeTypeOf('function');
  });

  it('should translate basic category query to Prisma findMany', async () => {
    const mockPrismaResult = [
      {
        id: 'p1',
        name: 'Red Snapper',
        slug: 'red-snapper',
        description: 'Fresh red snapper',
        price: 299,
        category: 'Fish',
        quantity: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.product.findMany).mockResolvedValue(mockPrismaResult as any);

    const result = await ProductModel.find({ category: 'Fish' });

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { category: 'Fish' },
      orderBy: undefined,
      skip: undefined,
      take: undefined,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(ProductModel);
    expect(result[0].name).toBe('Red Snapper');
    expect(result[0]._id).toBe('p1');
  });

  it('should translate complex $or regex queries to Prisma conditions', async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([]);

    await ProductModel.find({
      $or: [
        { name: { $regex: 'Tuna', $options: 'i' } },
        { description: { $regex: 'Tuna', $options: 'i' } },
      ],
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: 'Tuna', mode: 'insensitive' } },
          { description: { contains: 'Tuna', mode: 'insensitive' } },
        ],
      },
      orderBy: undefined,
      skip: undefined,
      take: undefined,
    });
  });

  it('should support updating records with findByIdAndUpdate', async () => {
    const mockPrismaResult = {
      id: 'p1',
      name: 'Salmon',
      slug: 'salmon',
      description: 'Atlantic salmon',
      price: 499,
      category: 'Fish',
      quantity: 5,
    };

    vi.mocked(prisma.product.update).mockResolvedValue(mockPrismaResult as any);

    const result = await ProductModel.findByIdAndUpdate('p1', {
      $set: { price: 549 },
    });

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { price: 549 },
    });

    expect(result).toBeInstanceOf(ProductModel);
    expect(result.price).toBe(499); // Returned from prisma result
  });
});
