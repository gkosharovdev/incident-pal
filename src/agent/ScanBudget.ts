const DEFAULT_SCAN_BUDGET_BYTES = 1_073_741_824; // 1 GB

export class ScanBudget {
  private bytesUsed = 0;
  readonly budgetBytes: number;

  constructor(budgetBytes = DEFAULT_SCAN_BUDGET_BYTES) {
    this.budgetBytes = budgetBytes;
  }

  canAfford(estimatedBytes: number): boolean {
    return this.bytesUsed + estimatedBytes <= this.budgetBytes;
  }

  record(bytesUsed: number): void {
    this.bytesUsed += bytesUsed;
  }

  get used(): number {
    return this.bytesUsed;
  }

  get remaining(): number {
    return Math.max(0, this.budgetBytes - this.bytesUsed);
  }

  get isExhausted(): boolean {
    return this.bytesUsed >= this.budgetBytes;
  }
}
