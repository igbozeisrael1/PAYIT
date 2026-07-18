// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IERC20 — Minimal interface for PayITEscrow (duplicated to keep file self-contained)
interface IERC20Escrow {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title PayITEscrow
/// @notice Holds USDC in escrow for pending transfers to unregistered PayIT users.
/// @dev When a PayIT user sends money to a non-user (identified by hashed phone/Telegram handle),
///      funds are locked here. On claim, the recipient's new wallet receives the funds.
///      After expiry, the sender can refund. Backend operator coordinates claim verification.
contract PayITEscrow {
    // ─── Types ──────────────────────────────────────────────────────────────────

    enum DepositStatus {
        PENDING,
        CLAIMED,
        REFUNDED
    }

    struct Deposit {
        uint256 id;
        address sender;           // Wallet address of the sender
        bytes32 recipientHash;    // keccak256(recipientIdentifier) — phone, Telegram ID etc.
        uint256 amount;           // USDC amount in base units (6 decimals)
        uint256 expiresAt;        // Unix timestamp after which sender can refund
        DepositStatus status;
        uint256 createdAt;
        uint256 resolvedAt;       // Set on claim or refund
        address resolvedTo;       // Address funds were sent to on resolution
    }

    // ─── Constants ───────────────────────────────────────────────────────────────

    uint256 public constant MIN_EXPIRY_DURATION = 1 days;
    uint256 public constant MAX_EXPIRY_DURATION = 30 days;

    // ─── State ──────────────────────────────────────────────────────────────────

    IERC20Escrow public immutable usdc;
    address public operator;
    uint256 public nextDepositId = 1;

    mapping(uint256 => Deposit) public deposits;
    // Mapping from recipientHash → list of pending depositIds (for claim sweep)
    mapping(bytes32 => uint256[]) private _recipientDeposits;

    // ─── Events ─────────────────────────────────────────────────────────────────

    event Deposited(
        uint256 indexed depositId,
        address indexed sender,
        bytes32 indexed recipientHash,
        uint256 amount,
        uint256 expiresAt
    );

    event Claimed(
        uint256 indexed depositId,
        bytes32 indexed recipientHash,
        address indexed claimerAddress,
        uint256 amount
    );

    event Refunded(
        uint256 indexed depositId,
        address indexed sender,
        uint256 amount
    );

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    // ─── Errors ──────────────────────────────────────────────────────────────────

    error Unauthorized();
    error DepositNotFound(uint256 depositId);
    error DepositNotPending(uint256 depositId);
    error ExpiryNotReached(uint256 depositId, uint256 expiresAt);
    error AlreadyExpired(uint256 depositId);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidExpiry();

    // ─── Constructor ────────────────────────────────────────────────────────────

    constructor(address _usdc, address _operator) {
        if (_usdc == address(0) || _operator == address(0)) revert InvalidAddress();
        usdc = IERC20Escrow(_usdc);
        operator = _operator;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    // ─── Core Functions ──────────────────────────────────────────────────────────

    /// @notice Lock USDC for a pending transfer to an unregistered user.
    /// @dev Caller must approve this contract to spend `amount` USDC first.
    ///      `recipientHash` is keccak256 of the off-chain identifier (phone / Telegram ID).
    ///      `expiryDuration` in seconds; must be between 1–30 days.
    function deposit(
        bytes32 recipientHash,
        uint256 amount,
        uint256 expiryDuration
    ) external returns (uint256 depositId) {
        if (amount == 0) revert InvalidAmount();
        if (recipientHash == bytes32(0)) revert InvalidAddress();
        if (expiryDuration < MIN_EXPIRY_DURATION || expiryDuration > MAX_EXPIRY_DURATION) {
            revert InvalidExpiry();
        }

        depositId = nextDepositId++;
        uint256 expiresAt = block.timestamp + expiryDuration;

        deposits[depositId] = Deposit({
            id: depositId,
            sender: msg.sender,
            recipientHash: recipientHash,
            amount: amount,
            expiresAt: expiresAt,
            status: DepositStatus.PENDING,
            createdAt: block.timestamp,
            resolvedAt: 0,
            resolvedTo: address(0)
        });

        _recipientDeposits[recipientHash].push(depositId);

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "PayITEscrow: USDC transfer failed");

        emit Deposited(depositId, msg.sender, recipientHash, amount, expiresAt);
    }

    /// @notice Claim all pending escrow deposits for a recipient. Called by the operator
    ///         when a new user completes onboarding and their identity is verified.
    /// @param recipientHash  The hashed identifier that was used during deposit
    /// @param claimerAddress The new user's wallet address to receive funds
    /// @return totalClaimed  Total USDC released to the claimer
    function claimAll(
        bytes32 recipientHash,
        address claimerAddress
    ) external onlyOperator returns (uint256 totalClaimed) {
        if (claimerAddress == address(0)) revert InvalidAddress();

        uint256[] storage ids = _recipientDeposits[recipientHash];
        uint256 len = ids.length;

        for (uint256 i = 0; i < len; i++) {
            uint256 depId = ids[i];
            Deposit storage dep = deposits[depId];

            // Skip already-resolved or expired deposits
            if (dep.status != DepositStatus.PENDING) continue;
            if (block.timestamp >= dep.expiresAt) continue;

            uint256 amt = dep.amount;

            // Checks-effects-interactions
            dep.status = DepositStatus.CLAIMED;
            dep.resolvedAt = block.timestamp;
            dep.resolvedTo = claimerAddress;
            totalClaimed += amt;

            bool ok = usdc.transfer(claimerAddress, amt);
            require(ok, "PayITEscrow: claim transfer failed");

            emit Claimed(depId, recipientHash, claimerAddress, amt);
        }
    }

    /// @notice Claim a single specific deposit by ID.
    function claimSingle(
        uint256 depositId,
        address claimerAddress
    ) external onlyOperator {
        if (claimerAddress == address(0)) revert InvalidAddress();

        Deposit storage dep = deposits[depositId];
        if (dep.id == 0) revert DepositNotFound(depositId);
        if (dep.status != DepositStatus.PENDING) revert DepositNotPending(depositId);
        if (block.timestamp >= dep.expiresAt) revert AlreadyExpired(depositId);

        uint256 amt = dep.amount;
        dep.status = DepositStatus.CLAIMED;
        dep.resolvedAt = block.timestamp;
        dep.resolvedTo = claimerAddress;

        bool ok = usdc.transfer(claimerAddress, amt);
        require(ok, "PayITEscrow: claim transfer failed");

        emit Claimed(depositId, dep.recipientHash, claimerAddress, amt);
    }

    /// @notice Refund an expired deposit back to the original sender.
    ///         Callable by anyone — no operator required, as this is permissionless.
    function refund(uint256 depositId) external {
        Deposit storage dep = deposits[depositId];
        if (dep.id == 0) revert DepositNotFound(depositId);
        if (dep.status != DepositStatus.PENDING) revert DepositNotPending(depositId);
        if (block.timestamp < dep.expiresAt) revert ExpiryNotReached(depositId, dep.expiresAt);

        address sender = dep.sender;
        uint256 amt = dep.amount;

        dep.status = DepositStatus.REFUNDED;
        dep.resolvedAt = block.timestamp;
        dep.resolvedTo = sender;

        bool ok = usdc.transfer(sender, amt);
        require(ok, "PayITEscrow: refund transfer failed");

        emit Refunded(depositId, sender, amt);
    }

    // ─── View Functions ──────────────────────────────────────────────────────────

    function getDeposit(uint256 depositId) external view returns (Deposit memory) {
        if (deposits[depositId].id == 0) revert DepositNotFound(depositId);
        return deposits[depositId];
    }

    function getPendingDepositIds(bytes32 recipientHash) external view returns (uint256[] memory) {
        return _recipientDeposits[recipientHash];
    }

    function totalDeposits() external view returns (uint256) {
        return nextDepositId - 1;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────────

    function setOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert InvalidAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }
}
