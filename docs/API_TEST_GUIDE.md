# 🧪 API Testing Guide - Debugging PayDues Issue

## Issue: Expenses not appearing in PayDues screen

### Root Cause Analysis

The issue was that the frontend was calling **v1 API endpoints** but the new `/dues` route was added to **v2 routes**.

### Solution Applied

Updated `expenseAPI.js` to use **v2 API client** for new unified endpoints:
- `createUnifiedExpense` → `/api/v2/expenses`
- `getUserDues` → `/api/v2/expenses/dues`
- `recordBulkPayment` → `/api/v2/expenses/pay`
- `getExpenseHistory` → `/api/v2/expenses/flat/:flatId`

---

## 🔍 How to Test

### Step 1: Verify Backend is Running
```bash
# Check health endpoint
curl http://localhost:8000/health

# Expected response:
# {"status":"ok","message":"Server is running"}
```

### Step 2: Test getUserDues Endpoint

#### Get your auth token first:
```bash
# Login to get token
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}'

# Copy the accessToken from response
```

#### Test the dues endpoint:
```bash
# Replace YOUR_TOKEN and YOUR_FLAT_ID
curl -X GET "http://localhost:8000/api/v2/expenses/dues?flatId=YOUR_FLAT_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response:
{
  "statusCode": 200,
  "data": {
    "billDues": [...],
    "expenseDues": [...],
    "totalBillDue": 0,
    "totalExpenseDue": 0,
    "totalDue": 0,
    "count": 0
  },
  "message": "User dues fetched successfully",
  "success": true
}
```

### Step 3: Create a Test Bill
```bash
curl -X POST http://localhost:8000/api/v2/expenses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "flatId": "YOUR_FLAT_ID",
    "type": "shared",
    "title": "Test Bill",
    "totalAmount": 1000,
    "category": "utilities",
    "splitMethod": "equal",
    "dueDate": "2025-11-30",
    "participants": [
      {"userId": "USER_ID_1"},
      {"userId": "USER_ID_2"}
    ]
  }'

# Expected response:
{
  "statusCode": 201,
  "data": {
    "type": "shared",
    "expense": {...},
    "splits": [...]
  },
  "message": "Bill created successfully",
  "success": true
}
```

### Step 4: Check Dues Again
```bash
# Run the dues endpoint again
curl -X GET "http://localhost:8000/api/v2/expenses/dues?flatId=YOUR_FLAT_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should now show billDues with the new bill
```

---

## 📱 Frontend Testing

### Step 1: Clear App Cache
```bash
# In your app
1. Force close the app
2. Reopen it
3. Pull to refresh on PayDues screen
```

### Step 2: Check Console Logs

Look for these logs when opening PayDues:

```javascript
// Should see:
🔵 [API] Fetching user dues via V2 for flatId: xxx
✅ Token attached to request: GET /expenses/dues
✅ [API] User dues fetched: { data: {...} }
🔄 [Redux V2] Fetching user dues from API...
✅ [Redux V2] User dues fetched successfully
💰 PayDues - billDues: 1
💰 PayDues - expenseDues: 0
💰 PayDues - userDues total: 1
```

### Step 3: Create Bill from App
```javascript
// Expected flow:
1. Go to Bills tab
2. Click "Create Bill"
3. Fill details and submit
4. Check console for:
   🔵 [API] Creating unified expense via V2...
   ✅ [API] Expense created successfully
5. Navigate to PayDues
6. Bill should appear immediately
```

---

## 🐛 Common Issues

### Issue 1: "Cannot connect to backend server"
**Solution**: 
- Check if backend is running: `npm start` in Backend folder
- Verify LOCAL_URL in `apiClient.js` matches your IP address

### Issue 2: "Resource not found" (404)
**Solution**:
- Verify you're using v2 endpoints: `/api/v2/expenses/dues`
- Check backend logs for route registration

### Issue 3: "Authentication required" (401)
**Solution**:
- Re-login to get fresh token
- Check if token is being attached (look for "Token attached" log)

### Issue 4: PayDues still empty after creating bill
**Check**:
1. Backend logs - does `getUserDues` service method run?
2. Database - are BillSplit documents created with status='owed'?
3. Frontend logs - is the data received but not displayed?

---

## 🔍 Debugging Checklist

- [ ] Backend running on correct port (8000)
- [ ] Frontend using correct IP in apiClient.js
- [ ] Auth token is valid and attached to requests
- [ ] Bill created successfully (check database)
- [ ] BillSplits created with correct userId
- [ ] getUserDues endpoint returns data
- [ ] Frontend receives data (check Redux state)
- [ ] UI renders the data

---

## 📊 Expected Console Output

### Creating Bill:
```
🔵 [API] Creating unified expense via V2...
✅ Token attached to request: POST /expenses
📝 [V2] Creating unified expense: shared
✅ [V2] Expense created: 673a1234567890abcdef
✅ [API] Expense created successfully
```

### Loading PayDues:
```
🔵 [API] Fetching user dues via V2 for flatId: 673a1234567890abcdef
✅ Token attached to request: GET /expenses/dues
🔵 [ExpenseService] getUserDues called: { userId: xxx, flatId: xxx }
🔵 [ExpenseService] Raw billDues count: 1
🔵 [ExpenseService] Filtered billDues count: 1
✅ [ExpenseService] getUserDues result: { billDuesCount: 1, totalDue: 500 }
✅ [API] User dues fetched: { data: { billDues: [...], totalDue: 500 } }
💰 PayDues - billDues: 1
```

---

## ✅ Success Criteria

All of these should work:

1. ✅ Create bill → Backend logs show bill created
2. ✅ BillSplits created in database
3. ✅ Open PayDues → API called with correct endpoint
4. ✅ Backend returns dues data
5. ✅ Frontend displays dues in UI
6. ✅ Pay bill → Removed from PayDues
7. ✅ Appears in History tab

---

**If issue persists after these fixes, check:**
- MongoDB connection (bills and billsplits collections)
- User ID matching (are you logged in as the right user?)
- Flat ID (are you in the correct flat?)
