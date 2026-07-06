export class ObjectIdWrapper {
  _id: string;

  constructor(id: string) {
    this._id = id;
  }

  toString() {
    return this._id;
  }

  equals(other: any) {
    if (!other) return false;
    return this._id === (other.toString ? other.toString() : other);
  }
}

export class ProductIdWrapper extends ObjectIdWrapper {
  name?: string;
  slug?: string;
  description?: string;
  price?: number;
  pricePerKg?: number;
  imageUrl?: string;
  imageHint?: string;
  category?: string;
  quantity?: number;
  stockKg?: number;
  reservedStock?: number;
  maxQuantity?: number;
  availability?: boolean;
  createdAt?: Date;
  updatedAt?: Date;

  constructor(id: string, productData?: any) {
    super(id);
    if (productData) {
      this.name = productData.name;
      this.slug = productData.slug;
      this.description = productData.description;
      this.price = productData.price;
      this.pricePerKg = productData.pricePerKg;
      this.imageUrl = productData.imageUrl;
      this.imageHint = productData.imageHint;
      this.category = productData.category;
      this.quantity = productData.quantity;
      this.stockKg = productData.stockKg;
      this.reservedStock = productData.reservedStock;
      this.maxQuantity = productData.maxQuantity;
      this.availability = productData.availability;
      this.createdAt = productData.createdAt;
      this.updatedAt = productData.updatedAt;
    }
  }
}
