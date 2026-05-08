import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');

  useEffect(() => {
    // Optional: You could verify the payment status here again if needed
    console.log('Payment success for order:', orderId);
  }, [orderId]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">Payment Successful!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-gray-600">
            Thank you for your investment. Your payment has been processed successfully.
            {orderId && <span className="block mt-2 font-medium text-gray-900">Order ID: {orderId}</span>}
          </p>
          
          <div className="pt-4">
            <Button 
              onClick={() => navigate('/dashboard')} 
              className="w-full flex items-center justify-center gap-2"
            >
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          
          <p className="text-xs text-gray-400">
            It may take a few minutes for your balance to update.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentSuccess;
