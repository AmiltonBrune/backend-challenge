class Moeda {
  descrever(): string {
    return 'moeda';
  }
}

export class Real extends Moeda {
  descrever(): string {
    return 'real';
  }
}
