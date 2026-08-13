import { IsNotEmpty, IsString } from 'class-validator';

export class ProviderExternalTransactionParamDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;
}
