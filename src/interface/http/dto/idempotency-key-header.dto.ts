import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class IdempotencyKeyHeaderDto {
  @IsString()
  @IsNotEmpty({ message: 'Idempotency-Key é obrigatório' })
  @MaxLength(255)
  idempotencyKey!: string;
}
