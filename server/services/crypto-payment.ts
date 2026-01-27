import { SUBSCRIPTION_PRICE_USD } from "@shared/schema";

interface PaymentAddresses {
  SOL: string;
  ETH: string;
  BSC: string;
  BASE: string;
}

interface CryptoPrices {
  SOL: number;
  ETH: number;
  BNB: number;
}

interface PaymentAmount {
  chain: string;
  amount: string;
  symbol: string;
  usdValue: number;
}

interface TransactionVerification {
  isValid: boolean;
  amount: number;
  from: string;
  to: string;
  timestamp: number;
  confirmations: number;
  error?: string;
}

const DEFAULT_PAYMENT_ADDRESSES: PaymentAddresses = {
  SOL: "",
  ETH: "",
  BSC: "",
  BASE: "",
};

class CryptoPaymentService {
  private paymentAddresses: PaymentAddresses;
  private cachedPrices: CryptoPrices | null = null;
  private pricesCacheTime: number = 0;
  private readonly CACHE_DURATION = 60 * 1000;

  constructor() {
    this.paymentAddresses = {
      SOL: process.env.PAYMENT_ADDRESS_SOL || DEFAULT_PAYMENT_ADDRESSES.SOL,
      ETH: process.env.PAYMENT_ADDRESS_ETH || DEFAULT_PAYMENT_ADDRESSES.ETH,
      BSC: process.env.PAYMENT_ADDRESS_BSC || DEFAULT_PAYMENT_ADDRESSES.BSC,
      BASE: process.env.PAYMENT_ADDRESS_BASE || DEFAULT_PAYMENT_ADDRESSES.BASE,
    };
  }

  updatePaymentAddresses(addresses: Partial<PaymentAddresses>) {
    this.paymentAddresses = { ...this.paymentAddresses, ...addresses };
  }

  getPaymentAddresses(): PaymentAddresses {
    return this.paymentAddresses;
  }

  async fetchCryptoPrices(): Promise<CryptoPrices> {
    const now = Date.now();
    if (this.cachedPrices && (now - this.pricesCacheTime) < this.CACHE_DURATION) {
      return this.cachedPrices;
    }

    try {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,binancecoin&vs_currencies=usd"
      );
      
      if (!response.ok) {
        throw new Error("Failed to fetch prices");
      }

      const data = await response.json();
      
      this.cachedPrices = {
        SOL: data.solana?.usd || 150,
        ETH: data.ethereum?.usd || 3000,
        BNB: data.binancecoin?.usd || 600,
      };
      this.pricesCacheTime = now;
      
      console.log("[CryptoPayment] Fetched prices:", this.cachedPrices);
      return this.cachedPrices;
    } catch (error) {
      console.error("[CryptoPayment] Error fetching prices:", error);
      return this.cachedPrices || {
        SOL: 150,
        ETH: 3000,
        BNB: 600,
      };
    }
  }

  async calculatePaymentAmounts(): Promise<PaymentAmount[]> {
    const prices = await this.fetchCryptoPrices();
    
    return [
      {
        chain: "SOL",
        amount: (SUBSCRIPTION_PRICE_USD / prices.SOL).toFixed(4),
        symbol: "SOL",
        usdValue: SUBSCRIPTION_PRICE_USD,
      },
      {
        chain: "ETH",
        amount: (SUBSCRIPTION_PRICE_USD / prices.ETH).toFixed(6),
        symbol: "ETH",
        usdValue: SUBSCRIPTION_PRICE_USD,
      },
      {
        chain: "BSC",
        amount: (SUBSCRIPTION_PRICE_USD / prices.BNB).toFixed(4),
        symbol: "BNB",
        usdValue: SUBSCRIPTION_PRICE_USD,
      },
      {
        chain: "BASE",
        amount: (SUBSCRIPTION_PRICE_USD / prices.ETH).toFixed(6),
        symbol: "ETH",
        usdValue: SUBSCRIPTION_PRICE_USD,
      },
    ];
  }

  async verifyTransaction(chain: string, txHash: string): Promise<TransactionVerification> {
    try {
      switch (chain.toUpperCase()) {
        case "SOL":
          return await this.verifySolanaTransaction(txHash);
        case "ETH":
          return await this.verifyEthereumTransaction(txHash, "ethereum");
        case "BSC":
          return await this.verifyBSCTransaction(txHash);
        case "BASE":
          return await this.verifyEthereumTransaction(txHash, "base");
        default:
          return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: "Unsupported chain" };
      }
    } catch (error) {
      console.error(`[CryptoPayment] Error verifying ${chain} transaction:`, error);
      return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: String(error) };
    }
  }

  private async verifySolanaTransaction(txHash: string): Promise<TransactionVerification> {
    const heliusKey = process.env.HELIUS_API_KEY;
    
    try {
      const url = heliusKey 
        ? `https://api.helius.xyz/v0/transactions/?api-key=${heliusKey}`
        : "https://api.mainnet-beta.solana.com";

      if (heliusKey) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactions: [txHash],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data[0]) {
            const tx = data[0];
            const nativeTransfer = tx.nativeTransfers?.[0];
            
            if (nativeTransfer) {
              const amount = nativeTransfer.amount / 1e9;
              const to = nativeTransfer.toUserAccount?.toLowerCase();
              const expectedAddress = this.paymentAddresses.SOL.toLowerCase();
              
              const prices = await this.fetchCryptoPrices();
              const expectedAmount = SUBSCRIPTION_PRICE_USD / prices.SOL;
              const tolerance = expectedAmount * 0.05;
              
              const isValidAmount = amount >= (expectedAmount - tolerance);
              const isValidRecipient = to === expectedAddress;
              
              return {
                isValid: isValidAmount && isValidRecipient,
                amount,
                from: nativeTransfer.fromUserAccount || "",
                to: to || "",
                timestamp: tx.timestamp * 1000,
                confirmations: tx.slot ? 1 : 0,
                error: !isValidAmount ? "Insufficient amount" : (!isValidRecipient ? "Wrong recipient" : undefined),
              };
            }
          }
        }
      }

      const rpcResponse = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [txHash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
        }),
      });

      const rpcData = await rpcResponse.json();
      
      if (rpcData.result) {
        const tx = rpcData.result;
        const preBalances = tx.meta?.preBalances || [];
        const postBalances = tx.meta?.postBalances || [];
        const accountKeys = tx.transaction?.message?.accountKeys || [];
        
        let transferAmount = 0;
        let recipient = "";
        let sender = "";
        
        for (let i = 0; i < accountKeys.length; i++) {
          const diff = (postBalances[i] - preBalances[i]) / 1e9;
          if (diff > 0 && accountKeys[i].pubkey) {
            recipient = accountKeys[i].pubkey;
            transferAmount = diff;
          }
          if (diff < 0 && accountKeys[i].pubkey) {
            sender = accountKeys[i].pubkey;
          }
        }
        
        const prices = await this.fetchCryptoPrices();
        const expectedAmount = SUBSCRIPTION_PRICE_USD / prices.SOL;
        const tolerance = expectedAmount * 0.05;
        
        const isValidAmount = transferAmount >= (expectedAmount - tolerance);
        const isValidRecipient = recipient.toLowerCase() === this.paymentAddresses.SOL.toLowerCase();
        
        return {
          isValid: isValidAmount && isValidRecipient && tx.meta?.err === null,
          amount: transferAmount,
          from: sender,
          to: recipient,
          timestamp: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
          confirmations: tx.slot ? 1 : 0,
          error: tx.meta?.err ? "Transaction failed" : (!isValidAmount ? "Insufficient amount" : (!isValidRecipient ? "Wrong recipient" : undefined)),
        };
      }

      return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: "Transaction not found" };
    } catch (error) {
      console.error("[CryptoPayment] Solana verification error:", error);
      return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: String(error) };
    }
  }

  private async verifyEthereumTransaction(txHash: string, network: "ethereum" | "base"): Promise<TransactionVerification> {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    
    try {
      const baseUrl = network === "base" 
        ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey || "demo"}`
        : `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey || "demo"}`;

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionByHash",
          params: [txHash],
        }),
      });

      const data = await response.json();
      
      if (data.result) {
        const tx = data.result;
        const valueWei = BigInt(tx.value || "0");
        const amount = Number(valueWei) / 1e18;
        
        const expectedAddress = (network === "base" ? this.paymentAddresses.BASE : this.paymentAddresses.ETH).toLowerCase();
        const isValidRecipient = tx.to?.toLowerCase() === expectedAddress;
        
        const prices = await this.fetchCryptoPrices();
        const expectedAmount = SUBSCRIPTION_PRICE_USD / prices.ETH;
        const tolerance = expectedAmount * 0.05;
        
        const isValidAmount = amount >= (expectedAmount - tolerance);

        const receiptResponse = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getTransactionReceipt",
            params: [txHash],
          }),
        });
        
        const receiptData = await receiptResponse.json();
        const isConfirmed = receiptData.result?.status === "0x1";
        
        return {
          isValid: isValidAmount && isValidRecipient && isConfirmed,
          amount,
          from: tx.from || "",
          to: tx.to || "",
          timestamp: Date.now(),
          confirmations: isConfirmed ? 1 : 0,
          error: !isConfirmed ? "Transaction not confirmed" : (!isValidAmount ? "Insufficient amount" : (!isValidRecipient ? "Wrong recipient" : undefined)),
        };
      }

      return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: "Transaction not found" };
    } catch (error) {
      console.error(`[CryptoPayment] ${network} verification error:`, error);
      return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: String(error) };
    }
  }

  private async verifyBSCTransaction(txHash: string): Promise<TransactionVerification> {
    const bscscanKey = process.env.BSCSCAN_API_KEY;
    
    try {
      const url = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${bscscanKey || "YourApiKeyToken"}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.result && data.result.hash) {
        const tx = data.result;
        const valueWei = BigInt(tx.value || "0");
        const amount = Number(valueWei) / 1e18;
        
        const expectedAddress = this.paymentAddresses.BSC.toLowerCase();
        const isValidRecipient = tx.to?.toLowerCase() === expectedAddress;
        
        const prices = await this.fetchCryptoPrices();
        const expectedAmount = SUBSCRIPTION_PRICE_USD / prices.BNB;
        const tolerance = expectedAmount * 0.05;
        
        const isValidAmount = amount >= (expectedAmount - tolerance);

        const receiptUrl = `https://api.bscscan.com/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${bscscanKey || "YourApiKeyToken"}`;
        const receiptResponse = await fetch(receiptUrl);
        const receiptData = await receiptResponse.json();
        const isConfirmed = receiptData.result?.status === "0x1";
        
        return {
          isValid: isValidAmount && isValidRecipient && isConfirmed,
          amount,
          from: tx.from || "",
          to: tx.to || "",
          timestamp: Date.now(),
          confirmations: isConfirmed ? 1 : 0,
          error: !isConfirmed ? "Transaction not confirmed" : (!isValidAmount ? "Insufficient amount" : (!isValidRecipient ? "Wrong recipient" : undefined)),
        };
      }

      return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: "Transaction not found" };
    } catch (error) {
      console.error("[CryptoPayment] BSC verification error:", error);
      return { isValid: false, amount: 0, from: "", to: "", timestamp: 0, confirmations: 0, error: String(error) };
    }
  }

  async validatePaymentAndActivate(
    chain: string, 
    txHash: string,
    userId: string
  ): Promise<{ success: boolean; message: string; verification?: TransactionVerification }> {
    const verification = await this.verifyTransaction(chain, txHash);
    
    if (!verification.isValid) {
      return {
        success: false,
        message: verification.error || "Payment verification failed",
        verification,
      };
    }

    return {
      success: true,
      message: "Payment verified successfully",
      verification,
    };
  }
}

export const cryptoPaymentService = new CryptoPaymentService();
