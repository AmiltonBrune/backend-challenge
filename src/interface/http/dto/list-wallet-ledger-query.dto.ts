import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListWalletLedgerQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um número inteiro entre 1 e 100' })
  @Min(1, { message: 'limit deve ser um número inteiro entre 1 e 100' })
  @Max(100, { message: 'limit deve ser um número inteiro entre 1 e 100' })
  limit?: number;
}
