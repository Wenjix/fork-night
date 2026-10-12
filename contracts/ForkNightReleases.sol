// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.24;

/// @notice Testnet-only, contribution-derived release payments. Wallets, not unique humans, receive shares.
contract ForkNightReleases {
    uint256 public constant MAX_PATH_LENGTH = 32;
    bytes32 public constant POLICY = keccak256("fork-night/equal-wallets/v1");

    struct Project { address curator; bytes32 termsHash; bytes32 root; }
    struct Moment {
        bytes32 projectId;
        bytes32 parentId;
        bytes32 manifestHash;
        bytes32 makerId;
        address beneficiary;
        uint256 depth;
    }
    struct Release {
        bytes32 projectId;
        bytes32 tipId;
        bytes32 manifestHash;
        uint256 received;
        uint256 claimed;
        address[] beneficiaries;
    }
    struct Payment { bytes32 releaseId; uint256 amount; }

    mapping(bytes32 => Project) public projects;
    mapping(bytes32 => mapping(bytes32 => address)) public makers;
    mapping(bytes32 => Moment) public moments;
    mapping(bytes32 => Release) private releases;
    mapping(bytes32 => mapping(address => uint256)) public claimed;
    mapping(address => mapping(bytes32 => Payment)) public payments;
    uint256 public liability;
    bool private claiming;

    error TestNetworkOnly();
    error InvalidCommitment();
    error AlreadyExists();
    error UnknownProject();
    error NotCurator();
    error NotMaker();
    error InvalidParent();
    error PathTooLong();
    error UnknownRelease();
    error InvalidPayment();
    error DuplicatePayment();
    error NothingToClaim();
    error TransferFailed();
    error ReentrantClaim();

    event ProjectCreated(bytes32 indexed projectId, address indexed curator, bytes32 termsHash);
    event MakerApproved(bytes32 indexed projectId, bytes32 indexed makerId, address indexed account);
    event MomentRegistered(bytes32 indexed momentId, bytes32 indexed projectId, address indexed beneficiary, bytes32 parentId, bytes32 makerId, bytes32 manifestHash);
    event ReleasePublished(bytes32 indexed releaseId, bytes32 indexed projectId, bytes32 tipId, bytes32 manifestHash, address[] beneficiaries);
    event ReleaseSupported(bytes32 indexed releaseId, address indexed payer, bytes32 indexed paymentId, uint256 amount, uint256 received);
    event Claimed(bytes32 indexed releaseId, address indexed beneficiary, uint256 amount);

    constructor() {
        if (block.chainid != 10143 && block.chainid != 31337) revert TestNetworkOnly();
    }

    function projectKey(address curator, bytes32 sourceKey) public pure returns (bytes32) {
        return keccak256(abi.encode(curator, sourceKey));
    }

    function momentKey(bytes32 projectId, bytes32 makerId, bytes32 sourceKey) public pure returns (bytes32) {
        return keccak256(abi.encode(projectId, makerId, sourceKey));
    }

    function createProject(bytes32 sourceKey, bytes32 termsHash, bytes32 rootMakerId, bytes32 rootSourceKey) external returns (bytes32 projectId) {
        if (sourceKey == bytes32(0) || termsHash == bytes32(0) || rootMakerId == bytes32(0) || rootSourceKey == bytes32(0)) revert InvalidCommitment();
        projectId = projectKey(msg.sender, sourceKey);
        if (projects[projectId].curator != address(0)) revert AlreadyExists();
        projects[projectId] = Project(msg.sender, termsHash, momentKey(projectId, rootMakerId, rootSourceKey));
        emit ProjectCreated(projectId, msg.sender, termsHash);
    }

    /// @notice Curator admission binds an application maker ID permanently to a wallet.
    /// It is a disclosed identity attestation, not proof of a distinct person or copyright.
    function approveMaker(bytes32 projectId, bytes32 makerId, address account) external {
        Project storage project = projects[projectId];
        _curator(project);
        if (makerId == bytes32(0) || account == address(0)) revert InvalidCommitment();
        if (makers[projectId][makerId] != address(0)) revert AlreadyExists();
        makers[projectId][makerId] = account;
        emit MakerApproved(projectId, makerId, account);
    }

    function registerMoment(bytes32 projectId, bytes32 sourceKey, bytes32 parentId, bytes32 makerId, bytes32 manifestHash, bytes32 acceptedTermsHash) external returns (bytes32 momentId) {
        Project storage project = projects[projectId];
        if (project.curator == address(0)) revert UnknownProject();
        if (acceptedTermsHash != project.termsHash || sourceKey == bytes32(0) || manifestHash == bytes32(0)) revert InvalidCommitment();
        if (makers[projectId][makerId] != msg.sender) revert NotMaker();
        momentId = momentKey(projectId, makerId, sourceKey);
        if (moments[momentId].beneficiary != address(0)) revert AlreadyExists();
        uint256 depth = 1;
        if (parentId == bytes32(0)) {
            if (momentId != project.root) revert InvalidParent();
        } else {
            Moment storage parent = moments[parentId];
            if (parent.beneficiary == address(0) || parent.projectId != projectId) revert InvalidParent();
            depth = parent.depth + 1;
            if (depth > MAX_PATH_LENGTH) revert PathTooLong();
        }
        moments[momentId] = Moment(projectId, parentId, manifestHash, makerId, msg.sender, depth);
        emit MomentRegistered(momentId, projectId, msg.sender, parentId, makerId, manifestHash);
    }

    function releaseKey(bytes32 projectId, bytes32 tipId, bytes32 manifestHash) public pure returns (bytes32) {
        return keccak256(abi.encode(projectId, tipId, manifestHash));
    }

    function publishRelease(bytes32 projectId, bytes32 tipId, bytes32 manifestHash) external returns (bytes32 releaseId) {
        Project storage project = projects[projectId];
        _curator(project);
        if (manifestHash == bytes32(0)) revert InvalidCommitment();
        Moment storage tip = moments[tipId];
        if (tip.beneficiary == address(0) || tip.projectId != projectId) revert InvalidParent();
        releaseId = releaseKey(projectId, tipId, manifestHash);
        if (releases[releaseId].projectId != bytes32(0)) revert AlreadyExists();
        Release storage release = releases[releaseId];
        release.projectId = projectId;
        release.tipId = tipId;
        release.manifestHash = manifestHash;
        bytes32 cursor = tipId;
        bytes32 root;
        for (uint256 i; i < tip.depth; ++i) {
            Moment storage moment = moments[cursor];
            address account = moment.beneficiary;
            bool included;
            for (uint256 j; j < release.beneficiaries.length; ++j) {
                if (release.beneficiaries[j] == account) { included = true; break; }
            }
            if (!included) release.beneficiaries.push(account);
            root = cursor;
            cursor = moment.parentId;
        }
        if (cursor != bytes32(0) || root != project.root) revert InvalidParent();
        // Canonical order makes cumulative remainder allocation independent of publishing and claim order.
        for (uint256 i = 1; i < release.beneficiaries.length; ++i) {
            address account = release.beneficiaries[i];
            uint256 j = i;
            while (j > 0 && uint160(release.beneficiaries[j - 1]) > uint160(account)) {
                release.beneficiaries[j] = release.beneficiaries[j - 1];
                --j;
            }
            release.beneficiaries[j] = account;
        }
        emit ReleasePublished(releaseId, projectId, tipId, manifestHash, release.beneficiaries);
    }

    function getRelease(bytes32 releaseId) external view returns (bytes32 projectId, bytes32 tipId, bytes32 manifestHash, uint256 received, uint256 paid, address[] memory beneficiaries) {
        Release storage release = releases[releaseId];
        return (release.projectId, release.tipId, release.manifestHash, release.received, release.claimed, release.beneficiaries);
    }

    function supportRelease(bytes32 releaseId, bytes32 paymentId) external payable {
        Release storage release = releases[releaseId];
        if (release.projectId == bytes32(0)) revert UnknownRelease();
        if (msg.value == 0 || paymentId == bytes32(0)) revert InvalidPayment();
        if (payments[msg.sender][paymentId].amount != 0) revert DuplicatePayment();
        payments[msg.sender][paymentId] = Payment(releaseId, msg.value);
        release.received += msg.value;
        liability += msg.value;
        emit ReleaseSupported(releaseId, msg.sender, paymentId, msg.value, release.received);
    }

    function claimable(bytes32 releaseId, address account) public view returns (uint256) {
        Release storage release = releases[releaseId];
        uint256 count = release.beneficiaries.length;
        for (uint256 i; i < count; ++i) {
            if (release.beneficiaries[i] == account) {
                uint256 entitlement = release.received / count + (i < release.received % count ? 1 : 0);
                return entitlement - claimed[releaseId][account];
            }
        }
        return 0;
    }

    /// @notice Anyone may trigger a claim; all funds go to the frozen beneficiary.
    function claim(bytes32 releaseId, address beneficiary) external {
        if (claiming) revert ReentrantClaim();
        uint256 amount = claimable(releaseId, beneficiary);
        if (amount == 0) revert NothingToClaim();
        claiming = true;
        claimed[releaseId][beneficiary] += amount;
        releases[releaseId].claimed += amount;
        liability -= amount;
        (bool sent,) = payable(beneficiary).call{value: amount}("");
        if (!sent) revert TransferFailed();
        claiming = false;
        emit Claimed(releaseId, beneficiary, amount);
    }

    function _curator(Project storage project) private view {
        if (project.curator == address(0)) revert UnknownProject();
        if (project.curator != msg.sender) revert NotCurator();
    }
}
