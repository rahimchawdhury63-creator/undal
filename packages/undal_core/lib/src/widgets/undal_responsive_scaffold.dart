/// Universal UNDAL Responsive Scaffold (`Decision D-15` & Test `WEB-02`).
///
/// Adapts seamlessly from `240px` ultra-compact phones (bottom bar, zero horizontal overflow)
/// through `768px` Android tablets (`NavigationRail`) up to `3840px` 4K displays (`extended` rail
/// + centered max-width container).
library;

import 'package:flutter/material.dart';

import '../tokens/undal_tokens.dart';

/// Single primary navigation destination shared across mobile bar and tablet rail.
final class UndalNavItem {
  const UndalNavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    this.badgeCount = 0,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final int badgeCount;
}

/// Overflow-safe responsive application scaffold used across all 3 UNDAL Flutter apps.
class UndalResponsiveScaffold extends StatelessWidget {
  const UndalResponsiveScaffold({
    super.key,
    required this.title,
    required this.body,
    required this.destinations,
    required this.selectedIndex,
    required this.onDestinationSelected,
    this.titleWidget,
    this.topBanner,
    this.actions = const <Widget>[],
  });

  final String title;
  final Widget? titleWidget;
  final Widget? topBanner;
  final Widget body;
  final List<UndalNavItem> destinations;
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<Widget> actions;

  Widget _badgedIcon(IconData icon, int count) {
    return Badge(
      isLabelVisible: count > 0,
      label: Text('$count'),
      child: Icon(icon),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        final bool useRail = width >= UndalBreakpointTokens.tablet768;
        final bool extendedRail = width >= UndalBreakpointTokens.desktop1280;
        final bool ultraCompact = width < UndalBreakpointTokens.mobile320;

        final PreferredSizeWidget appBar = AppBar(
          automaticallyImplyLeading: false,
          titleSpacing:
              ultraCompact ? UndalSpacingTokens.xs : UndalSpacingTokens.md,
          title: titleWidget ??
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
          actions: actions,
        );

        final Widget innerBody = topBanner == null
            ? body
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  topBanner!,
                  Expanded(child: body),
                ],
              );

        final Widget constrainedBody = Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1360),
            child: innerBody,
          ),
        );

        if (useRail) {
          return Scaffold(
            appBar: appBar,
            body: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                NavigationRail(
                  extended: extendedRail,
                  selectedIndex: selectedIndex,
                  onDestinationSelected: onDestinationSelected,
                  labelType: extendedRail
                      ? NavigationRailLabelType.none
                      : NavigationRailLabelType.all,
                  destinations: destinations
                      .map(
                        (UndalNavItem d) => NavigationRailDestination(
                          icon: _badgedIcon(d.icon, d.badgeCount),
                          selectedIcon:
                              _badgedIcon(d.selectedIcon, d.badgeCount),
                          label: Text(
                            d.label,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                      .toList(),
                ),
                const VerticalDivider(width: 1),
                Expanded(child: constrainedBody),
              ],
            ),
          );
        }

        return Scaffold(
          appBar: appBar,
          body: constrainedBody,
          bottomNavigationBar: NavigationBar(
            labelBehavior: ultraCompact
                ? NavigationDestinationLabelBehavior.alwaysHide
                : NavigationDestinationLabelBehavior.alwaysShow,
            selectedIndex: selectedIndex,
            onDestinationSelected: onDestinationSelected,
            destinations: destinations
                .map(
                  (UndalNavItem d) => NavigationDestination(
                    icon: _badgedIcon(d.icon, d.badgeCount),
                    selectedIcon: _badgedIcon(d.selectedIcon, d.badgeCount),
                    label: d.label,
                  ),
                )
                .toList(),
          ),
        );
      },
    );
  }
}
