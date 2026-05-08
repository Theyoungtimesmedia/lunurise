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

// ✅ FIXED: Use the same URL as the website for the API
const API_BASE_URL = window.location.origin;

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
    
    try {
      const orderNo = generateOrderNo();

      const response = await fetch(`${API_BASE_URL}/api/nekpay/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNo: orderNo,
          amount: plan.deposit_usd,
          subject: plan.name,
          planId: plan.id
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      if (data.code === 0 && data.data) {
        setOrderInfo({ ...data.data, mchOrderNo: data.data.mchOrderNo || orderNo });
        setPaymentStatus('pending');
        
        if (data.data.payUrl) {
          window.open(data.data.payUrl, 'nekpay_payment', 'width=800,height=700');
          setPaymentStatus('checking');
          setTimeout(() => checkPaymentStatus(orderNo), 5000);
        } else {
          throw new Error('No payment URL received');
        }
      } else {
        throw new Error(data.msg || 'Payment creation failed');
      }
    } catch (err) {
      setPaymentStatus('failed');
      setErrorMessage(err.message || 'Payment request failed');
    } finally {
      setLoading(false);
    }
  };

  const checkPaymentStatus = async (mchOrderNo, attempt = 0) => {
    if (attempt >= 30) {
      setPaymentStatus('timeout');
      return;
    }

    setCheckAttempts(attempt + 1);

    try {
      const response = await fetch(`${API_BASE_URL}/api/nekpay/query-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mchOrderNo })
      });

      const data = await response.json();
      if (data.code === 0 && data.data) {
        if (data.data.state === 2) {
          setPaymentStatus('success');
          if (onPaymentSuccess) {
            setSaveStatus('saving');
            await onPaymentSuccess({ ...data.data, status: 'completed' });
            setSaveStatus('saved');
            setTimeout(onClose, 3000);
          }
          return;
        } else if (data.data.state === 3) {
          setPaymentStatus('failed');
          return;
        }
        setTimeout(() => checkPaymentStatus(mchOrderNo, attempt + 1), 6000);
      }
    } catch (err) {
      setTimeout(() => checkPaymentStatus(mchOrderNo, attempt + 1), 6000);
    }
  };

  const handleClose = () => {
    onClose();
    setTimeout(resetForm, 300);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Secure Payment - NEKpay</DialogTitle>
        </DialogHeader>

        <Card className="mb-4">
          <CardContent className="pt-6">
            <div className="flex justify-between">
              <span>Plan: {plan.name}</span>
              <span className="font-bold">${plan.deposit_usd}</span>
            </div>
          </CardContent>
        </Card>

        {(paymentStatus !== 'idle' || errorMessage) && (
          <Alert className={paymentStatus === 'failed' ? 'border-red-500' : ''}>
            <AlertDescription>{errorMessage || `Status: ${paymentStatus}`}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <Input
            placeholder="Full Name"
            value={paymentForm.customerName}
            onChange={e => setPaymentForm(prev => ({ ...prev, customerName: e.target.value }))}
          />
          <Input
            placeholder="Email"
            value={paymentForm.customerEmail}
            onChange={e => setPaymentForm(prev => ({ ...prev, customerEmail: e.target.value }))}
          />
          <div className="flex items-center space-x-2">
            <Checkbox id="terms" checked={paymentForm.confirmTerms} onCheckedChange={setPaymentForm.confirmTerms} />
            <Label htmlFor="terms">I agree to the terms</Label>
          </div>
          <Button className="w-full" onClick={handleNEKpayPayment} disabled={loading || paymentStatus === 'success'}>
            {loading ? 'Processing...' : `Pay $${plan.deposit_usd}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentModalNEKpay;
