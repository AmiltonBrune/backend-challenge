export class LivenessState {
  private healthy = true;

  isHealthy(): boolean {
    return this.healthy;
  }

  markUnhealthy(): void {
    this.healthy = false;
  }
}
