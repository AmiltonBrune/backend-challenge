import { IsNotEmpty, IsString } from 'class-validator';

export class TransactionIdParamDto {
  @IsString()
  @IsNotEmpty()
  transactionId!: string;
}
