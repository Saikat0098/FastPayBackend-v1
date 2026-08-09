const parseSms = (smsBody, senderAddress = '') => {
  if (!smsBody) {
    return { provider: 'Unknown', amount: 0, transactionId: '', sender: '', isPayment: false };
  }

  const text = smsBody.trim();
  const addressUpper = (senderAddress || '').toUpperCase();

  // 1. bKash Parser
  if (addressUpper.includes('BKASH') || text.toLowerCase().includes('bkash')) {
    const txMatch = text.match(/TrxID\s+([A-Z0-9]+)/i) || text.match(/TxnID\s+([A-Z0-9]+)/i);
    const amountMatch = text.match(/(?:Tk|BDT)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    const senderMatch = text.match(/from\s+([0-9+]+)/i) || text.match(/sender\s+([0-9+]+)/i);
    const refMatch = text.match(/Ref\s+([^.]+)/i);

    return {
      provider: 'bKash',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'bKash User',
      reference: refMatch ? refMatch[1].trim() : '',
      isPayment: !!(txMatch && amountMatch)
    };
  }

  // 2. Nagad Parser
  if (addressUpper.includes('NAGAD') || text.toLowerCase().includes('nagad')) {
    const txMatch = text.match(/TxnID:\s*([A-Z0-9]+)/i) || text.match(/TxnID\s*([A-Z0-9]+)/i);
    const amountMatch = text.match(/(?:Amount|Tk)\s*:?\s*(?:Tk|BDT)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    const senderMatch = text.match(/From:\s*([0-9+]+)/i) || text.match(/From\s+([0-9+]+)/i);
    const refMatch = text.match(/Ref:\s*([^.]+)/i);

    return {
      provider: 'Nagad',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'Nagad User',
      reference: refMatch ? refMatch[1].trim() : '',
      isPayment: !!(txMatch && amountMatch)
    };
  }

  // 3. Rocket Parser
  if (addressUpper.includes('ROCKET') || addressUpper.includes('16216') || text.toLowerCase().includes('rocket')) {
    const txMatch = text.match(/TxnID:\s*([A-Z0-9]+)/i) || text.match(/Txn:\s*([A-Z0-9]+)/i);
    const amountMatch = text.match(/(?:Tk|BDT)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    const senderMatch = text.match(/from\s+([0-9+]+)/i);

    return {
      provider: 'Rocket',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'Rocket User',
      reference: '',
      isPayment: !!(txMatch && amountMatch)
    };
  }

  // 4. Upay Parser
  if (addressUpper.includes('UPAY') || text.toLowerCase().includes('upay')) {
    const txMatch = text.match(/TrxID:\s*([A-Z0-9]+)/i) || text.match(/TrxID\s*([A-Z0-9]+)/i);
    const amountMatch = text.match(/(?:Tk|BDT)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    const senderMatch = text.match(/from\s+([0-9+]+)/i);

    return {
      provider: 'Upay',
      transactionId: txMatch ? txMatch[1].trim() : '',
      amount: amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0,
      sender: senderMatch ? senderMatch[1].trim() : 'Upay User',
      reference: '',
      isPayment: !!(txMatch && amountMatch)
    };
  }

  // 5. Generic Bank / Payment SMS Parser
  const genericTx = text.match(/(?:TxnID|TrxID|Ref|Ref No|CR\/|TRN)\s*:?\s*([A-Z0-9]+)/i);
  const genericAmount = text.match(/(?:Tk|BDT|USD|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) || text.match(/credited with\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);

  if (genericTx && genericAmount) {
    return {
      provider: addressUpper || 'Bank Transfer',
      transactionId: genericTx[1].trim(),
      amount: parseFloat(genericAmount[1].replace(/,/g, '')),
      sender: 'Bank Customer',
      reference: '',
      isPayment: true
    };
  }

  return {
    provider: addressUpper || 'Unknown',
    transactionId: '',
    amount: 0,
    sender: 'Unknown',
    reference: '',
    isPayment: false
  };
};

module.exports = { parseSms };
