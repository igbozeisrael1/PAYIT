// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IERC20 — Minimal interface used by PayIT contracts
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title PayITInvoiceLedger
/// @notice On-chain tamper-proof invoice ledger with automatic VAT/WHT splitting.
/// @dev Deployed on Monad. The backend relays user-signed actions; only the operator
///      (backend wallet) can create invoices on behalf of users. Any address can pay
///      an invoice by calling `payInvoice`. Anyone can read any invoice — it is public
///      by design so clients and auditors can independently verify records.
contract PayITInvoiceLedger {
    // ─── Types ──────────────────────────────────────────────────────────────────

    enum InvoiceStatus {
        PENDING,
        PAID,
        CANCELLED
    }

    struct Invoice {
        uint256 id;
        address businessAddress;   // Business wallet receiving net payment
        bytes32 clientRef;         // Hashed client identifier (off-chain resolution)
        bytes32 lineItemsHash;     // keccak256 of plaintext line items stored off-chain
        uint256 subtotal;          // Before tax, in USDC base units (6 decimals)
        uint256 vatAmount;         // VAT portion in USDC base units
        uint256 whtAmount;         // WHT portion in USDC base units
        uint256 total;             // subtotal + vatAmount (WHT is deducted from business)
        InvoiceStatus status;
        uint256 createdAt;
        uint256 paidAt;
    }

    // ─── State ──────────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public operator;          // PayIT backend relay wallet
    address public whtHolding;        // Multisig or treasury that holds WHT
    uint256 public nextInvoiceId = 1;

    mapping(uint256 => Invoice) public invoices;

    // ─── Events ─────────────────────────────────────────────────────────────────

    event InvoiceCreated(
        uint256 indexed invoiceId,
        address indexed businessAddress,
        bytes32 clientRef,
        bytes32 lineItemsHash,
        uint256 subtotal,
        uint256 vatAmount,
        uint256 whtAmount,
        uint256 total,
        uint256 createdAt
    );

    event InvoicePaid(
        uint256 indexed invoiceId,
        address indexed payer,
        uint256 netToBusinessAmount,
        uint256 whtDeducted,
        uint256 paidAt
    );

    event InvoiceCancelled(uint256 indexed invoiceId, uint256 cancelledAt);

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event WhtHoldingUpdated(address indexed oldWhtHolding, address indexed newWhtHolding);

    // ─── Errors ──────────────────────────────────────────────────────────────────

    error Unauthorized();
    error InvoiceNotFound(uint256 invoiceId);
    error InvoiceNotPendingPayment(uint256 invoiceId, InvoiceStatus status);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidCalculation();

    // ─── Constructor ────────────────────────────────────────────────────────────

    constructor(address _usdc, address _operator, address _whtHolding) {
        if (_usdc == address(0) || _operator == address(0) || _whtHolding == address(0)) {
            revert InvalidAddress();
        }
        usdc = IERC20(_usdc);
        operator = _operator;
        whtHolding = _whtHolding;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    // ─── Core Functions ──────────────────────────────────────────────────────────

    /// @notice Create a new invoice on-chain. Only callable by the operator backend.
    /// @param businessAddress The business wallet address to receive payment
    /// @param clientRef       keccak256 of the client identifier (e.g. phone or Telegram ID hash)
    /// @param lineItemsHash   keccak256 of the full JSON line-item list stored off-chain
    /// @param subtotal        Subtotal in USDC base units before tax
    /// @param vatAmount       VAT amount in USDC base units
    /// @param whtAmount       WHT amount in USDC base units (deducted from business net)
    /// @param total           Total due = subtotal + vatAmount (payer pays this)
    /// @return invoiceId      The new invoice's on-chain ID
    function createInvoice(
        address businessAddress,
        bytes32 clientRef,
        bytes32 lineItemsHash,
        uint256 subtotal,
        uint256 vatAmount,
        uint256 whtAmount,
        uint256 total
    ) external onlyOperator returns (uint256 invoiceId) {
        if (businessAddress == address(0)) revert InvalidAddress();
        if (subtotal == 0 || total == 0) revert InvalidAmount();
        // Validate: total must equal subtotal + vatAmount
        if (total != subtotal + vatAmount) revert InvalidCalculation();
        // WHT must not exceed the subtotal (it is deducted from business net)
        if (whtAmount > subtotal) revert InvalidCalculation();

        invoiceId = nextInvoiceId++;

        invoices[invoiceId] = Invoice({
            id: invoiceId,
            businessAddress: businessAddress,
            clientRef: clientRef,
            lineItemsHash: lineItemsHash,
            subtotal: subtotal,
            vatAmount: vatAmount,
            whtAmount: whtAmount,
            total: total,
            status: InvoiceStatus.PENDING,
            createdAt: block.timestamp,
            paidAt: 0
        });

        emit InvoiceCreated(
            invoiceId,
            businessAddress,
            clientRef,
            lineItemsHash,
            subtotal,
            vatAmount,
            whtAmount,
            total,
            block.timestamp
        );
    }

    /// @notice Pay an invoice. Caller must have approved this contract to spend `total` USDC.
    /// @dev Atomic split: (total - whtAmount) goes to business, whtAmount goes to whtHolding.
    ///      VAT is embedded in the total already paid to the business.
    /// @param invoiceId The ID of the invoice to pay
    function payInvoice(uint256 invoiceId) external {
        Invoice storage inv = invoices[invoiceId];

        if (inv.id == 0) revert InvoiceNotFound(invoiceId);
        if (inv.status != InvoiceStatus.PENDING) {
            revert InvoiceNotPendingPayment(invoiceId, inv.status);
        }

        uint256 netToBusiness = inv.total - inv.whtAmount;

        // Mark paid before external calls (checks-effects-interactions)
        inv.status = InvoiceStatus.PAID;
        inv.paidAt = block.timestamp;

        // Transfer total from payer to this contract
        bool ok = usdc.transferFrom(msg.sender, address(this), inv.total);
        require(ok, "PayITInvoiceLedger: USDC transfer failed");

        // Route WHT to holding address
        if (inv.whtAmount > 0) {
            ok = usdc.transfer(whtHolding, inv.whtAmount);
            require(ok, "PayITInvoiceLedger: WHT transfer failed");
        }

        // Route net amount to business
        ok = usdc.transfer(inv.businessAddress, netToBusiness);
        require(ok, "PayITInvoiceLedger: Business transfer failed");

        emit InvoicePaid(invoiceId, msg.sender, netToBusiness, inv.whtAmount, block.timestamp);
    }

    /// @notice Cancel a pending invoice. Only the operator can cancel.
    function cancelInvoice(uint256 invoiceId) external onlyOperator {
        Invoice storage inv = invoices[invoiceId];
        if (inv.id == 0) revert InvoiceNotFound(invoiceId);
        if (inv.status != InvoiceStatus.PENDING) {
            revert InvoiceNotPendingPayment(invoiceId, inv.status);
        }
        inv.status = InvoiceStatus.CANCELLED;
        emit InvoiceCancelled(invoiceId, block.timestamp);
    }

    // ─── View Functions ──────────────────────────────────────────────────────────

    /// @notice Fetch a full invoice record. Public — accessible to anyone for auditability.
    function getInvoice(uint256 invoiceId) external view returns (Invoice memory) {
        if (invoices[invoiceId].id == 0) revert InvoiceNotFound(invoiceId);
        return invoices[invoiceId];
    }

    /// @notice Get total count of invoices created so far
    function totalInvoices() external view returns (uint256) {
        return nextInvoiceId - 1;
    }

    // ─── Admin Functions ─────────────────────────────────────────────────────────

    function setOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert InvalidAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function setWhtHolding(address newWhtHolding) external onlyOperator {
        if (newWhtHolding == address(0)) revert InvalidAddress();
        emit WhtHoldingUpdated(whtHolding, newWhtHolding);
        whtHolding = newWhtHolding;
    }
}
