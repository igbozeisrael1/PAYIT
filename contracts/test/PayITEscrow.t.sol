// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PayITEscrow} from "../src/PayITEscrow.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @title PayITEscrow Tests
contract PayITEscrowTest {
    PayITEscrow public escrow;
    MockUSDC public usdc;

    address public sender = address(0xB001);
    address public claimer = address(0xB002);
    address public other = address(0xB003);

    bytes32 public recipientHash = keccak256("+2348012345678");

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new PayITEscrow(address(usdc), address(this)); // this = operator

        usdc.mint(address(this), 100_000 * 1e6);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function assertEq(uint256 a, uint256 b, string memory reason) internal pure {
        require(a == b, reason);
    }
    function assertEq(address a, address b, string memory reason) internal pure {
        require(a == b, reason);
    }

    function test_deposit_success() public {
        uint256 depositId = escrow.deposit(recipientHash, 50_000_000, 14 days);
        assertEq(depositId, 1, "First deposit ID should be 1");

        PayITEscrow.Deposit memory dep = escrow.getDeposit(1);
        assertEq(dep.amount, 50_000_000, "Amount mismatch");
        assertEq(uint256(dep.status), 0, "Status should be PENDING");
        assertEq(dep.sender, address(this), "Sender mismatch");
    }

    function test_deposit_invalidAmount_reverts() public {
        bool reverted = false;
        try escrow.deposit(recipientHash, 0, 14 days) {
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on zero amount");
    }

    function test_deposit_invalidExpiry_reverts() public {
        bool reverted = false;
        try escrow.deposit(recipientHash, 50_000_000, 31 days) {
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on expiry > 30 days");
    }

    function test_claimSingle_success() public {
        escrow.deposit(recipientHash, 50_000_000, 14 days);

        uint256 claimerBefore = usdc.balanceOf(claimer);
        escrow.claimSingle(1, claimer);
        uint256 claimerAfter = usdc.balanceOf(claimer);

        assertEq(claimerAfter - claimerBefore, 50_000_000, "Claimer should receive full amount");

        PayITEscrow.Deposit memory dep = escrow.getDeposit(1);
        assertEq(uint256(dep.status), 1, "Status should be CLAIMED");
        assertEq(dep.resolvedTo, claimer, "ResolvedTo mismatch");
    }

    function test_claimAll_multipleDeposits() public {
        escrow.deposit(recipientHash, 30_000_000, 14 days);
        escrow.deposit(recipientHash, 20_000_000, 14 days);

        uint256 claimerBefore = usdc.balanceOf(claimer);
        uint256 total = escrow.claimAll(recipientHash, claimer);
        uint256 claimerAfter = usdc.balanceOf(claimer);

        assertEq(total, 50_000_000, "Total claimed should be sum of both deposits");
        assertEq(claimerAfter - claimerBefore, 50_000_000, "Claimer balance mismatch");
    }

    function test_claimSingle_alreadyClaimed_reverts() public {
        escrow.deposit(recipientHash, 50_000_000, 14 days);
        escrow.claimSingle(1, claimer);

        bool reverted = false;
        try escrow.claimSingle(1, claimer) {
        } catch {
            reverted = true;
        }
        require(reverted, "Double claim should revert");
    }

    function test_refund_beforeExpiry_reverts() public {
        escrow.deposit(recipientHash, 50_000_000, 14 days);

        bool reverted = false;
        try escrow.refund(1) {
        } catch {
            reverted = true;
        }
        require(reverted, "Refund before expiry should revert");
    }

    function test_getPendingDepositIds() public {
        escrow.deposit(recipientHash, 10_000_000, 7 days);
        escrow.deposit(recipientHash, 20_000_000, 7 days);

        uint256[] memory ids = escrow.getPendingDepositIds(recipientHash);
        assertEq(ids.length, 2, "Should have 2 pending deposits");
    }

    function test_totalDeposits() public {
        assertEq(escrow.totalDeposits(), 0, "Start at 0");
        escrow.deposit(recipientHash, 10_000_000, 7 days);
        escrow.deposit(keccak256("other"), 10_000_000, 7 days);
        assertEq(escrow.totalDeposits(), 2, "Should have 2 deposits");
    }
}
