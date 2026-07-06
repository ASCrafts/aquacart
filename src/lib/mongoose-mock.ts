class ObjectId {
  id: string;

  constructor(id?: any) {
    if (id && id.toString) {
      this.id = id.toString();
    } else {
      this.id = id || 'mock-id-' + Math.random().toString(36).substring(2, 11);
    }
  }

  toString() {
    return this.id;
  }

  equals(other: any) {
    if (!other) return false;
    return this.id === (other.toString ? other.toString() : other);
  }

  static isValid(val: any) {
    if (!val) return false;
    const str = val.toString();
    // Validate if it is a valid hex string of 24 chars (MongoDB ObjectId) or a standard CUID/UUID (SQL IDs)
    return str.length >= 8;
  }
}

class MockSession {
  inTransaction() {
    return true;
  }
  async startTransaction() {}
  async commitTransaction() {}
  async abortTransaction() {}
  endSession() {}
}

export const Types = {
  ObjectId,
};

export async function startSession() {
  return new MockSession();
}

export default {
  Types,
  startSession,
};
