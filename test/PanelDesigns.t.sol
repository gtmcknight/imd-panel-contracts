// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PanelDesigns} from "../src/PanelDesigns.sol";

/// Whether a design draws is the site's question (does the wallet hold a seat?); here a wallet only ever writes its own word.
contract PanelDesignsTest is Test {
    event DesignSet(address indexed holder, bytes32 design);

    PanelDesigns designs;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    bytes32 constant D = bytes32(uint256(0x01020304) << 224 | uint256(0xdeadbeef) << 192);

    function setUp() public {
        designs = new PanelDesigns();
    }

    function test_anyWalletSets() public {
        vm.expectEmit(true, false, false, true);
        emit DesignSet(alice, D);
        vm.prank(alice);
        designs.setDesign(D);
        assertEq(designs.designOf(alice), D);
        assertEq(designs.designOf(bob), bytes32(0));
    }

    function test_onlyYourOwn() public {
        vm.prank(alice);
        designs.setDesign(D);
        vm.prank(bob);
        designs.setDesign(bytes32(uint256(7)));
        vm.prank(bob);
        designs.clearDesign();
        // bob's writes and clears never reach alice's word
        assertEq(designs.designOf(alice), D);
        assertEq(designs.designOf(bob), bytes32(0));
    }

    function test_clear() public {
        vm.startPrank(alice);
        designs.setDesign(D);
        vm.expectEmit(true, false, false, true);
        emit DesignSet(alice, bytes32(0));
        designs.clearDesign();
        vm.stopPrank();
        assertEq(designs.designOf(alice), bytes32(0));
        // clearing what was never set is harmless
        vm.prank(carol);
        designs.clearDesign();
    }

    function test_overwrite() public {
        vm.startPrank(alice);
        designs.setDesign(D);
        designs.setDesign(bytes32(uint256(2)));
        vm.stopPrank();
        assertEq(designs.designOf(alice), bytes32(uint256(2)));
    }

    function test_batchRead() public {
        vm.prank(alice);
        designs.setDesign(D);
        vm.prank(bob);
        designs.setDesign(bytes32(uint256(3)));
        address[] memory who = new address[](4);
        (who[0], who[1], who[2], who[3]) = (carol, alice, bob, alice);
        bytes32[] memory out = designs.designsOf(who);
        assertEq(out.length, 4);
        assertEq(out[0], bytes32(0));
        assertEq(out[1], D);
        assertEq(out[2], bytes32(uint256(3)));
        assertEq(out[3], D);
        assertEq(designs.designsOf(new address[](0)).length, 0);
    }

    function testFuzz_writesOnlyCaller(address who, bytes32 d) public {
        vm.assume(who != alice);
        vm.prank(alice);
        designs.setDesign(D);
        vm.prank(who);
        designs.setDesign(d);
        assertEq(designs.designOf(who), d);
        assertEq(designs.designOf(alice), D);
    }
}
