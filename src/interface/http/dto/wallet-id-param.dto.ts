import { IsNotEmpty, IsString } from 'class-validator';

export class WalletIdParamDto {
  @IsString()
  @IsNotEmpty()
  walletId!: string;
}
