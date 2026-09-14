export interface EvidenceObjectClient {
  put(objectReference: string, ciphertext: Buffer): Promise<void>;
  get(objectReference: string): Promise<Buffer>;
  delete(objectReference: string): Promise<void>;
}

export class InMemoryEvidenceObjectClient implements EvidenceObjectClient {
  readonly objects = new Map<string, Buffer>();

  async put(objectReference: string, ciphertext: Buffer) { this.objects.set(objectReference, Buffer.from(ciphertext)); }
  async get(objectReference: string) {
    const value = this.objects.get(objectReference);
    if (!value) throw new Error("Evidence object not found.");
    return Buffer.from(value);
  }
  async delete(objectReference: string) { this.objects.delete(objectReference); }
}

