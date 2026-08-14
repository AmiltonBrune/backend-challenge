import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListWalletLedgerQueryDto {
  @ApiPropertyOptional({ description: 'Cursor de paginação retornado por uma página anterior.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um número inteiro entre 1 e 100' })
  @Min(1, { message: 'limit deve ser um número inteiro entre 1 e 100' })
  @Max(100, { message: 'limit deve ser um número inteiro entre 1 e 100' })
  limit?: number;
}
