// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PayITInvoiceLedger} from "../src/PayITInvoiceLedger.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @title Minimal test harness (no forge-std dependency)
/// @dev If Foundry is installed, replace this with: import "forge-std/Test.sol";
///      These tests are written to compile and run with `forge test`.
contract PayITInvoiceLedgerTest {
    PayITInvoiceLedger public ledger;
    MockUSDC public usdc;

    address public operator = address(0xA001);
    address public whtHolding = address(0xA002);
    address public business = address(0xA003);
    address public payer = address(0xA004);
    address public other = address(0xA005);

    // ─── Forge-compatible test helpers ──────────────────────────────────────────

    event log_string(string s);
    event log_uint(uint256 u);

    function setUp() public {
        // Deploy MockUSDC and ledger
        usdc = new MockUSDC();
        ledger = new PayITInvoiceLedger(address(usdc), operator, whtHolding);

        // Mint USDC to payer
        usdc.mint(payer, 10_000 * 1e6);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    function _createSampleInvoice() internal returns (uint256 invoiceId) {
        // 100 USDC subtotal, 7.5 USDC VAT, 5 USDC WHT, 107.5 USDC total
        // total = subtotal + vatAmount = 100 + 7.5 = 107.5
        // But WHT is deducted from business net, not added to total
        vm_prank(operator);
        invoiceId = ledger.createInvoice(
            business,
            keccak256("client@example.com"),
            keccak256('{"items":[{"desc":"Consulting","qty":1,"price":100}]}'),
            100_000_000,  // subtotal: 100 USDC
            7_500_000,    // VAT: 7.5 USDC
            5_000_000,    // WHT: 5 USDC
            107_500_000   // total: 107.5 USDC (subtotal + VAT)
        );
    }

    // Simple prank simulation for self-contained test
    address private _pranker;
    bool private _isPranking;

    function vm_prank(address pranker) internal {
        // Note: This is a placeholder — in real forge test, use vm.prank(pranker)
        _pranker = pranker;
        _isPranking = true;
    }

    function assertEq(uint256 a, uint256 b, string memory reason) internal pure {
        require(a == b, reason);
    }

    function assertEq(address a, address b, string memory reason) internal pure {
        require(a == b, reason);
    }

    // ─── Tests ───────────────────────────────────────────────────────────────────

    function test_createInvoice_success() public {
        // In real forge test: vm.prank(operator);
        // For standalone compile test, operator must be msg.sender
        // (These tests are meant to be run with forge which handles vm.prank)
        PayITInvoiceLedger localLedger = new PayITInvoiceLedger(
            address(usdc), address(this), whtHolding
        );

        uint256 invoiceId = localLedger.createInvoice(
            business,
            keccak256("client@example.com"),
            keccak256("line-items"),
            100_000_000,
            7_500_000,
            5_000_000,
            107_500_000
        );

        assertEq(invoiceId, 1, "First invoice ID should be 1");

        PayITInvoiceLedger.Invoice memory inv = localLedger.getInvoice(1);
        assertEq(inv.businessAddress, business, "Business address mismatch");
        assertEq(inv.total, 107_500_000, "Total mismatch");
        assertEq(uint256(inv.status), 0, "Status should be PENDING");
    }

    function test_createInvoice_invalidCalculation_reverts() public {
        PayITInvoiceLedger localLedger = new PayITInvoiceLedger(
            address(usdc), address(this), whtHolding
        );

        bool reverted = false;
        try localLedger.createInvoice(
            business,
            keccak256("client"),
            keccak256("items"),
            100_000_000,
            7_500_000,
            5_000_000,
            999_999_999  // Wrong total
        ) {
            // Should not reach here
        } catch {
            reverted = true;
        }
        require(reverted, "Should have reverted on invalid calculation");
    }

    function test_payInvoice_correctSplit() public {
        // Deploy fresh instances with this contract as operator
        MockUSDC freshUsdc = new MockUSDC();
        PayITInvoiceLedger freshLedger = new PayITInvoiceLedger(
            address(freshUsdc), address(this), whtHolding
        );

        // Mint to payer
        freshUsdc.mint(payer, 200_000_000);

        // Create invoice
        uint256 invoiceId = freshLedger.createInvoice(
            business,
            keccak256("client"),
            keccak256("items"),
            100_000_000,  // subtotal
            7_500_000,    // VAT
            5_000_000,    // WHT
            107_500_000   // total = subtotal + VAT
        );

        // Payer approves and pays
        // Note: In forge tests, vm.prank(payer) would be used here
        // For now we simulate by minting to address(this) and approving
        freshUsdc.mint(address(this), 200_000_000);
        freshUsdc.approve(address(freshLedger), 200_000_000);

        uint256 businessBefore = freshUsdc.balanceOf(business);
        uint256 whtBefore = freshUsdc.balanceOf(whtHolding);

        freshLedger.payInvoice(invoiceId);

        uint256 businessAfter = freshUsdc.balanceOf(business);
        uint256 whtAfter = freshUsdc.balanceOf(whtHolding);

        // Business receives: total - whtAmount = 107.5 - 5 = 102.5 USDC
        assertEq(businessAfter - businessBefore, 102_500_000, "Business net incorrect");
        // WHT holding receives: whtAmount = 5 USDC
        assertEq(whtAfter - whtBefore, 5_000_000, "WHT amount incorrect");

        // Invoice status should be PAID
        PayITInvoiceLedger.Invoice memory inv = freshLedger.getInvoice(invoiceId);
        assertEq(uint256(inv.status), 1, "Status should be PAID");
    }

    function test_payInvoice_alreadyPaid_reverts() public {
        MockUSDC freshUsdc = new MockUSDC();
        PayITInvoiceLedger freshLedger = new PayITInvoiceLedger(
            address(freshUsdc), address(this), whtHolding
        );

        freshUsdc.mint(address(this), 500_000_000);
        freshUsdc.approve(address(freshLedger), 500_000_000);

        uint256 invoiceId = freshLedger.createInvoice(
            business, keccak256("c"), keccak256("i"),
            100_000_000, 7_500_000, 5_000_000, 107_500_000
        );

        freshLedger.payInvoice(invoiceId);

        bool reverted = false;
        try freshLedger.payInvoice(invoiceId) {
        } catch {
            reverted = true;
        }
        require(reverted, "Double-pay should revert");
    }

    function test_cancelInvoice() public {
        MockUSDC freshUsdc = new MockUSDC();
        PayITInvoiceLedger freshLedger = new PayITInvoiceLedger(
            address(freshUsdc), address(this), whtHolding
        );

        uint256 invoiceId = freshLedger.createInvoice(
            business, keccak256("c"), keccak256("i"),
            100_000_000, 7_500_000, 5_000_000, 107_500_000
        );

        freshLedger.cancelInvoice(invoiceId);

        PayITInvoiceLedger.Invoice memory inv = freshLedger.getInvoice(invoiceId);
        assertEq(uint256(inv.status), 2, "Status should be CANCELLED");
    }

    function test_totalInvoices() public {
        MockUSDC freshUsdc = new MockUSDC();
        PayITInvoiceLedger freshLedger = new PayITInvoiceLedger(
            address(freshUsdc), address(this), whtHolding
        );

        assertEq(freshLedger.totalInvoices(), 0, "Should start at 0");

        freshLedger.createInvoice(
            business, keccak256("c1"), keccak256("i1"),
            100_000_000, 7_500_000, 5_000_000, 107_500_000
        );
        freshLedger.createInvoice(
            business, keccak256("c2"), keccak256("i2"),
            50_000_000, 3_750_000, 2_500_000, 53_750_000
        );

        assertEq(freshLedger.totalInvoices(), 2, "Should have 2 invoices");
    }
}
