import { useState, useEffect } from 'react';
import { CreditCard, ArrowLeft, AlertCircle, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';

const API_BASE_URL = 'https://lunurise-backend.onrender.com';
// Or use environment variable:
// const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://lunurise-backend.onrender.com';


const PaymentModalNEKpay = ({ 
  isOpen, 
  onClose, 
  plan,
  userEmail = '',
  onPaymentSuccess
}) => {
  const [loading, setLoading] = useState(false);
  const [orderInfo, setOrderInfo] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [checkAttempts, setCheckAttempts] = useState(0);
  const [saveStatus, setSaveStatus] = useState('');

  const [paymentForm, setPaymentForm] = useState({
    currency: 'USD',
    customerEmail: userEmail,
    customerName: '',
    customerPhone: '',
    confirmTerms: false
  });

  useEffect(() => {
    if (userEmail) {
      setPaymentForm(prev => ({ ...prev, customerEmail: userEmail }));
    }
  }, [userEmail]);

  const formatUSD = (usd) => `$${usd.toFixed(2)}`;

  const generateOrderNo = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9).toUpperCase();
    return `ORD${timestamp}${random}`;
  };

  const resetForm = () => {
    setPaymentStatus('idle');
    setErrorMessage('');
    setOrderInfo(null);
    setCheckAttempts(0);
    setSaveStatus('');
  };

  const handleNEKpayPayment = async () => {
    if (!paymentForm.customerEmail || !paymentForm.customerName) {
      setErrorMessage('Please fill in all required fields');
      return;
    }

    if (!paymentForm.confirmTerms) {
      setErrorMessage('Please confirm the payment terms');
      return;
    }

    setLoading(true);
    setPaymentStatus('creating');
    setErrorMessage('');
    setSaveStatus('');
    
    try {
      const orderNo = generateOrderNo();

      console.log('📤 Creating NEKpay payment order:', orderNo);

      const response = await fetch(`${API_BASE_URL}/api/nekpay/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNo: orderNo,
          amount: plan.deposit_usd,
          currency: paymentForm.currency,
          subject: plan.name,
          body: `Investment Plan: ${plan.name}`,
          userEmail: paymentForm.customerEmail,
          userName: paymentForm.customerName,
          planId: plan.id
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log('📥 NEKpay response:', data);

      if (data.code === 0 && data.data) {
        const completeOrderInfo = {
          mchOrderNo: data.data.mchOrderNo || orderNo,
          payOrderId: data.data.payOrderId || null,
          state: data.data.state || 0,
          amount: data.data.amount || plan.deposit_usd,
          currency: data.data.currency || paymentForm.currency,
          createTime: data.data.createTime || new Date().toISOString(),
          payUrl: data.data.payUrl || null
        };
        
        console.log('💾 Order info:', completeOrderInfo);
        setOrderInfo(completeOrderInfo);
        setPaymentStatus('pending');
        
        if (completeOrderInfo.payUrl) {
          // Open payment window
          const paymentWindow = window.open(
            completeOrderInfo.payUrl, 
            'nekpay_payment', 
            'width=800,height=700,scrollbars=yes,resizable=yes,location=yes,status=yes,menubar=no,toolbar=no'
          );
          
          if (paymentWindow) {
            setPaymentStatus('checking');
            // Start checking payment status after 5 seconds
            setTimeout(() => {
              checkPaymentStatus(orderNo);
            }, 5000);
          } else {
            setErrorMessage('Popup blocked! Please allow popups for this site, or click the link below to pay manually.');
          }
        } else {
          throw new Error('No payment URL received from NEKpay. Please try again.');
        }
      } else {
        throw new Error(data.msg || 'Payment creation failed');
      }
    } catch (err) {
      console.error('❌ Payment error:', err);
      setPaymentStatus('failed');
      
      if (err.message.includes('fetch') || err.message.includes('NetworkError')) {
        setErrorMessage(`Cannot connect to payment server. Please ensure the backend is running on ${API_BASE_URL}`);
      } else {
        setErrorMessage(err.message || 'Payment request failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const checkPaymentStatus = async (mchOrderNo, attempt = 0) => {
    const MAX_ATTEMPTS = 30; // Check for up to 3 minutes
    const INTERVAL_MS = 6000; // Every 6 seconds

    if (attempt >= MAX_ATTEMPTS) {
      setPaymentStatus('timeout');
      setErrorMessage(
        `Payment verification timeout after ${Math.floor(MAX_ATTEMPTS * INTERVAL_MS / 1000 / 60)} minutes. ` +
        `If you completed the payment, it will be verified automatically. ` +
        `Order ID: ${mchOrderNo}`
      );
      return;
    }

    setCheckAttempts(attempt + 1);

    try {
      console.log(`🔍 Checking payment status (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
      
      const response = await fetch(`${API_BASE_URL}/api/nekpay/query-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mchOrderNo })
      });

      if (!response.ok) {
        throw new Error('Query request failed');
      }

      const data = await response.json();
      
      if (data.code === 0 && data.data) {
        const state = data.data.state;
        
        // state: 0 = pending, 2 = success, 3 = failed
        if (state === 2) {
          console.log('✅ Payment verified as successful!');
          setPaymentStatus('success');
          
          // Prepare complete payment data
          const completePaymentData = {
            // Order identifiers
            mchOrderNo: String(data.data.mchOrderNo || mchOrderNo),
            payOrderId: String(data.data.payOrderId || ''),
            platformOrderNo: String(data.data.payOrderId || ''),
            
            // Payment details
            state: Number(data.data.state),
            amount: Number(data.data.amount || orderInfo?.amount || plan.deposit_usd),
            currency: String(data.data.currency || orderInfo?.currency || 'USD'),
            
            // Timestamps
            createTime: String(data.data.createTime || orderInfo?.createTime || new Date().toISOString()),
            paidTime: String(data.data.paidTime || new Date().toISOString()),
            
            // Customer info
            customerEmail: String(paymentForm.customerEmail),
            customerName: String(paymentForm.customerName),
            customerPhone: String(paymentForm.customerPhone || ''),
            
            // Plan details
            planId: String(plan.id),
            planName: String(plan.name),
            depositAmount: Number(plan.deposit_usd),
            totalReturn: Number(plan.total_return_usd),
            
            // Additional metadata
            paymentMethod: 'NEKpay',
            status: 'completed'
          };
          
          console.log('📦 Complete payment data:', completePaymentData);
          
          // Verify no undefined values
          const hasUndefined = Object.entries(completePaymentData).find(([key, val]) => val === undefined);
          if (hasUndefined) {
            console.error('⚠️ Found undefined value:', hasUndefined);
          }
          
          // Save payment data
          if (onPaymentSuccess) {
            setSaveStatus('saving');
            console.log('💾 Saving payment data...');
            
            try {
              await onPaymentSuccess(completePaymentData);
              setSaveStatus('saved');
              console.log('✅ Payment saved successfully!');
              
              // Close modal after 3 seconds
              setTimeout(() => { 
                onClose(); 
                resetForm(); 
              }, 3000);
            } catch (saveError) {
              console.error('❌ Save error:', saveError);
              setSaveStatus('save_failed');
              setErrorMessage(`Payment successful but failed to save: ${saveError.message}`);
            }
          } else {
            console.warn('⚠️ No onPaymentSuccess handler provided');
            setTimeout(() => { 
              onClose(); 
              resetForm(); 
            }, 3000);
          }
          
          return;
        } else if (state === 3) {
          console.log('❌ Payment failed or cancelled');
          setPaymentStatus('failed');
          setErrorMessage('Payment was cancelled or failed. Please try again.');
          return;
        }
        
        // Still pending, check again
        console.log('⏳ Payment still pending, will check again...');
        setTimeout(() => checkPaymentStatus(mchOrderNo, attempt + 1), INTERVAL_MS);
      } else {
        // No data, retry
        setTimeout(() => checkPaymentStatus(mchOrderNo, attempt + 1), INTERVAL_MS);
      }
    } catch (err) {
      console.error('Query error:', err);
      // Continue checking despite error
      setTimeout(() => checkPaymentStatus(mchOrderNo, attempt + 1), INTERVAL_MS);
    }
  };

  const handleClose = () => {
    if (paymentStatus === 'checking') {
      const confirm = window.confirm(
        'Payment verification is in progress. If you close now, your payment will still be processed but you may need to check your email for confirmation.\n\nAre you sure you want to close?'
      );
      if (!confirm) return;
    }
    onClose();
    setTimeout(resetForm, 300);
  };

  const getStatusIcon = () => {
    switch (paymentStatus) {
      case 'success': return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'failed': 
      case 'timeout': return <XCircle className="h-5 w-5 text-red-600" />;
      default: return <AlertCircle className="h-5 w-5" />;
    }
  };

  const getStatusMessage = () => {
    if (saveStatus === 'saving') return '💾 Saving payment details...';
    if (saveStatus === 'saved') return '✅ Payment saved successfully!';
    if (saveStatus === 'save_failed') return '⚠️ Payment successful but save failed';
    
    switch (paymentStatus) {
      case 'creating': return '🔄 Creating payment order...';
      case 'pending': return '🌐 Opening payment window...';
      case 'checking': return `⏳ Verifying payment... (${checkAttempts}/30)`;
      case 'success': return '✅ Payment verified successfully!';
      case 'failed': return '❌ Payment failed';
      case 'timeout': return '⏱️ Verification timeout - payment may still be processing';
      default: return '';
    }
  };

  const getStatusColor = () => {
    if (saveStatus === 'save_failed') return 'border-yellow-500 bg-yellow-50 text-yellow-900';
    
    switch (paymentStatus) {
      case 'success': return 'border-green-500 bg-green-50 text-green-900';
      case 'failed': return 'border-red-500 bg-red-50 text-red-900';
      case 'timeout': return 'border-orange-500 bg-orange-50 text-orange-900';
      default: return 'border-blue-500 bg-blue-50 text-blue-900';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleClose} disabled={loading}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            Secure Payment - NEKpay
          </DialogTitle>
        </DialogHeader>

        <Card className="mb-4 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Investment Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan:</span>
              <span className="font-medium">{plan.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Deposit Amount:</span>
              <span className="font-bold text-lg">{formatUSD(plan.deposit_usd)}</span>
            </div>
            <div className="flex justify-between text-xs pt-2 border-t">
              <span className="text-muted-foreground">Total Return:</span>
              <span className="text-green-600 font-semibold">{formatUSD(plan.total_return_usd)}</span>
            </div>
          </CardContent>
        </Card>

        {(paymentStatus !== 'idle' || errorMessage || saveStatus) && (
          <Alert className={errorMessage ? 'border-red-500 bg-red-50' : getStatusColor()}>
            {getStatusIcon()}
            <AlertDescription className="text-xs ml-2">
              {errorMessage || getStatusMessage()}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-sm font-medium">
              Email Address <span className="text-red-500">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={paymentForm.customerEmail}
              onChange={e => setPaymentForm(prev => ({ ...prev, customerEmail: e.target.value }))}
              disabled={loading || paymentStatus === 'checking'}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="name" className="text-sm font-medium">
              Full Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              placeholder="John Doe"
              value={paymentForm.customerName}
              onChange={e => setPaymentForm(prev => ({ ...prev, customerName: e.target.value }))}
              disabled={loading || paymentStatus === 'checking'}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="phone" className="text-sm font-medium">
              Phone Number (Optional)
            </Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+234 800 000 0000"
              value={paymentForm.customerPhone}
              onChange={e => setPaymentForm(prev => ({ ...prev, customerPhone: e.target.value }))}
              disabled={loading || paymentStatus === 'checking'}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="currency" className="text-sm font-medium">Currency</Label>
            <Select 
              value={paymentForm.currency} 
              onValueChange={v => setPaymentForm(prev => ({ ...prev, currency: v }))}
              disabled={loading || paymentStatus === 'checking'}
            >
              <SelectTrigger id="currency" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD - US Dollar</SelectItem>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
                <SelectItem value="GBP">GBP - British Pound</SelectItem>
                <SelectItem value="NGN">NGN - Nigerian Naira</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start space-x-2 pt-2">
            <Checkbox
              id="terms"
              checked={paymentForm.confirmTerms}
              onCheckedChange={c => setPaymentForm(prev => ({ ...prev, confirmTerms: c }))}
              disabled={loading || paymentStatus === 'checking'}
            />
            <Label htmlFor="terms" className="text-xs leading-relaxed cursor-pointer">
              I confirm this information is correct and agree to proceed with this payment
            </Label>
          </div>

          <Button 
            className="w-full" 
            onClick={handleNEKpayPayment} 
            disabled={
              loading || 
              !paymentForm.customerEmail || 
              !paymentForm.customerName ||
              !paymentForm.confirmTerms ||
              paymentStatus === 'checking' ||
              paymentStatus === 'success'
            }
            size="lg"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {paymentStatus === 'checking' ? 'Verifying Payment...' : 
             paymentStatus === 'success' ? '✓ Payment Complete' :
             loading ? 'Processing...' : 
             `Pay ${formatUSD(plan.deposit_usd)}`}
          </Button>

          {orderInfo?.payUrl && (paymentStatus === 'pending' || paymentStatus === 'checking') && (
            <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-xs text-blue-800 font-medium mb-2">Popup blocked or need to retry?</p>
              <a 
                href={orderInfo.payUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800 underline font-medium"
              >
                Click here to open payment page
              </a>
            </div>
          )}

          {orderInfo && (
            <Alert className="mt-4">
              <AlertDescription className="text-xs space-y-1">
                <div><strong>Order ID:</strong> {orderInfo.mchOrderNo}</div>
                {orderInfo.payOrderId && (
                  <div><strong>Platform Order:</strong> {orderInfo.payOrderId}</div>
                )}
                <div className="text-muted-foreground text-[10px] mt-2">
                  💾 Save this order ID for your records
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="text-[10px] text-muted-foreground text-center space-y-1 pt-4 border-t">
          <p className="flex items-center justify-center gap-1">
            <CreditCard className="h-3 w-3" />
            Secure payment powered by <strong>NEKpay</strong>
          </p>
          <p>🔒 256-bit SSL Encryption • PCI DSS Compliant</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentModalNEKpay;
